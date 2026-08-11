using System.Globalization;
using ELCS.API.Utils;
using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;

namespace ELCS.API.Services;

/// <summary>
/// Sales Order document.
///
/// Deliberately does NOT show lucky-draw coupons — the SO is the customer's
/// commercial record (items, sizes, colours, pieces, customization, advance,
/// balance). Coupons are a promotion tracked separately in the app.
/// </summary>
public class SalesOrderPdfService : ISalesOrderPdfService
{
    private readonly ILogger<SalesOrderPdfService> _logger;
    private readonly IWebHostEnvironment _env;
    private readonly IConfiguration _config;

    private static readonly CultureInfo Inr = CultureInfo.GetCultureInfo("en-IN");

    public SalesOrderPdfService(
        ILogger<SalesOrderPdfService> logger,
        IWebHostEnvironment env,
        IConfiguration config)
    {
        _logger = logger;
        _env = env;
        _config = config;
    }

    public async Task<string> GenerateAsync(OrderDetailDto order)
    {
        var sellerName    = _config["SalesOrder:SellerName"]    ?? "";
        var sellerAddress = _config["SalesOrder:SellerAddress"] ?? "";
        var sellerPhone   = _config["SalesOrder:SellerPhone"]   ?? "";
        var sellerGstin   = _config["SalesOrder:SellerGstin"]   ?? "";

        // A GUID in the filename keeps the PDF unguessable: /uploads is served
        // without authentication (Interakt must be able to fetch it by URL),
        // so a predictable name would expose every customer's order document.
        var fileName = $"{order.OrderNumber}-{Guid.NewGuid():N}.pdf";
        var folder = UploadPaths.LeadOrders(order.LeadId);
        var relativePath = $"{folder}/{fileName}";

        var absoluteDir = UploadPaths.EnsureFolder(folder);
        var absolutePath = Path.Combine(absoluteDir, fileName);

        var summary = order.LeadSummary;

        var document = Document.Create(container =>
        {
            container.Page(page =>
            {
                page.Size(PageSizes.A4);
                page.Margin(32);
                page.DefaultTextStyle(t => t.FontSize(9).FontColor(Colors.Grey.Darken4));

                // ── Header ──────────────────────────────────────────────
                page.Header().Column(col =>
                {
                    col.Item().Row(row =>
                    {
                        row.RelativeItem().Column(c =>
                        {
                            if (!string.IsNullOrWhiteSpace(sellerName))
                                c.Item().Text(sellerName).FontSize(14).Bold();
                            if (!string.IsNullOrWhiteSpace(sellerAddress))
                                c.Item().PaddingTop(1).Text(sellerAddress)
                                    .FontSize(8).FontColor(Colors.Grey.Darken1);
                            if (!string.IsNullOrWhiteSpace(sellerPhone))
                                c.Item().Text(sellerPhone).FontSize(8).FontColor(Colors.Grey.Darken1);
                            if (!string.IsNullOrWhiteSpace(sellerGstin))
                                c.Item().PaddingTop(1).Text($"GSTIN: {sellerGstin}")
                                    .FontSize(8).SemiBold().FontColor(Colors.Grey.Darken2);
                        });

                        row.ConstantItem(180).Column(c =>
                        {
                            c.Item().AlignRight().Text("SALES ORDER").FontSize(15).Bold();
                            c.Item().AlignRight().Text(order.OrderNumber)
                                .FontSize(10).FontColor(Colors.Grey.Darken2);
                            c.Item().AlignRight()
                                .Text((order.ConfirmedAt ?? order.CreatedAt).ToString("dd MMM yyyy", Inr))
                                .FontSize(8).FontColor(Colors.Grey.Darken1);
                        });
                    });

                    col.Item().PaddingTop(8).LineHorizontal(1).LineColor(Colors.Grey.Lighten1);
                });

                page.Content().PaddingVertical(12).Column(col =>
                {
                    // ── Customer ────────────────────────────────────────
                    col.Item().PaddingBottom(12).Row(row =>
                    {
                        // Buyer = the lead. Agency first where there is one, since
                        // that is who the order is billed to; the visitor is the
                        // contact underneath it.
                        row.RelativeItem().Column(c =>
                        {
                            c.Item().Text("BILL TO").FontSize(7).Bold().FontColor(Colors.Grey.Darken1);

                            var hasAgency = !string.IsNullOrWhiteSpace(order.LeadCompanyName);
                            c.Item().PaddingTop(2)
                                .Text(hasAgency ? order.LeadCompanyName! : (order.LeadName ?? "—"))
                                .FontSize(11).Bold();
                            if (hasAgency && !string.IsNullOrWhiteSpace(order.LeadName))
                                c.Item().Text(order.LeadName).FontColor(Colors.Grey.Darken2);

                            var place = string.Join(", ", new[] { order.LeadCity, order.LeadState }
                                .Where(v => !string.IsNullOrWhiteSpace(v)));
                            if (!string.IsNullOrWhiteSpace(order.LeadAddress))
                                c.Item().PaddingTop(1).Text(order.LeadAddress)
                                    .FontSize(8).FontColor(Colors.Grey.Darken1);
                            if (place.Length > 0)
                                c.Item().Text(place).FontSize(8).FontColor(Colors.Grey.Darken1);

                            if (!string.IsNullOrWhiteSpace(order.LeadPhone))
                                c.Item().PaddingTop(1).Text(order.LeadPhone).FontColor(Colors.Grey.Darken2);
                            if (!string.IsNullOrWhiteSpace(order.LeadEmail))
                                c.Item().Text(order.LeadEmail).FontSize(8).FontColor(Colors.Grey.Darken1);
                            if (!string.IsNullOrWhiteSpace(order.LeadGstNumber))
                                c.Item().PaddingTop(1).Text($"GSTIN: {order.LeadGstNumber}")
                                    .FontSize(8).SemiBold().FontColor(Colors.Grey.Darken2);
                        });

                        row.RelativeItem().AlignRight().Column(c =>
                        {
                            if (!string.IsNullOrWhiteSpace(order.ExhibitionName))
                            {
                                c.Item().AlignRight().Text("EXHIBITION")
                                    .FontSize(7).Bold().FontColor(Colors.Grey.Darken1);
                                c.Item().AlignRight().PaddingTop(2).Text(order.ExhibitionName);
                            }
                        });
                    });

                    // ── Items ───────────────────────────────────────────
                    // Column order follows the sheet the counter already uses:
                    // S.NO · IMAGE · BARCODE · FABRIC · COLOUR · SET QTY · RATE.
                    // Item, size and amount are additions — the customer needs to
                    // know which garment and which size, and the line total is
                    // what they check the advance against.
                    col.Item().Text("ITEM INFORMATION")
                        .FontSize(8).Bold().FontColor(Colors.Grey.Darken2);

                    col.Item().PaddingTop(4).Table(table =>
                    {
                        table.ColumnsDefinition(c =>
                        {
                            c.ConstantColumn(22);   // s.no
                            c.ConstantColumn(52);   // image
                            c.RelativeColumn(1.7f); // barcode
                            c.RelativeColumn(1.4f); // fabric
                            c.RelativeColumn(0.9f); // size
                            c.RelativeColumn(1.5f); // colour
                            c.ConstantColumn(40);   // set qty
                            c.RelativeColumn(1.3f); // rate
                            c.RelativeColumn(1.5f); // amount
                        });

                        table.Header(header =>
                        {
                            void H(string text, bool right = false)
                            {
                                var cell = header.Cell().Background(Colors.Grey.Lighten3).Padding(5);
                                (right ? cell.AlignRight() : cell)
                                    .Text(text).FontSize(7).Bold().FontColor(Colors.Grey.Darken3);
                            }

                            H("S.NO"); H("IMAGE"); H("BARCODE"); H("FABRIC");
                            H("SIZE"); H("COLOUR"); H("SET QTY", true); H("RATE", true); H("AMOUNT", true);
                        });

                        foreach (var item in order.Items)
                        {
                            IContainer Cell() => table.Cell()
                                .BorderBottom(1).BorderColor(Colors.Grey.Lighten2).Padding(5);

                            Cell().AlignMiddle().Text(item.LineNumber.ToString()).FontColor(Colors.Grey.Darken1);

                            // The garment photo, read straight off disk. A missing or
                            // unreadable file must not fail the whole document — the
                            // SO is the commercial record and has to render regardless.
                            var photo = LoadProductImage(item.ProductImagePath);
                            var imgCell = table.Cell()
                                .BorderBottom(1).BorderColor(Colors.Grey.Lighten2).Padding(3);
                            if (photo != null)
                                imgCell.Height(56).Image(photo).FitArea();
                            else
                                imgCell.AlignMiddle().AlignCenter()
                                    .Text("—").FontSize(8).FontColor(Colors.Grey.Medium);

                            Cell().AlignMiddle().Text(Dash(item.Barcode)).FontSize(8);
                            Cell().AlignMiddle().Text(Dash(item.Fabric)).FontSize(8);
                            Cell().AlignMiddle().Text(Dash(item.Size));
                            Cell().AlignMiddle().Text(Dash(item.Colour));
                            Cell().AlignMiddle().AlignRight().Text(item.Pieces.ToString());
                            // Rate is optional — an unpriced line shows a dash rather
                            // than a misleading ₹0.00.
                            Cell().AlignMiddle().AlignRight().Text(item.Rate.HasValue ? Money(item.Rate.Value) : "—");
                            Cell().AlignMiddle().AlignRight().Text(item.Amount.HasValue ? Money(item.Amount.Value) : "—").Bold();

                            // Customization spans the full width beneath its line
                            if (!string.IsNullOrWhiteSpace(item.Customization))
                            {
                                table.Cell().ColumnSpan(9)
                                    .BorderBottom(1).BorderColor(Colors.Grey.Lighten2)
                                    .PaddingLeft(25).PaddingBottom(5)
                                    .Text($"Customization: {item.Customization}")
                                    .FontSize(8).Italic().FontColor(Colors.Grey.Darken2);
                            }
                        }
                    });

                    // ── Totals ──────────────────────────────────────────
                    // ShowEntire keeps the block whole: split across a page break
                    // the customer reads a balance with no value above it, which
                    // is worse than a shorter last page. Width matches the RATE +
                    // AMOUNT columns of the table so the figures form one column
                    // down the right-hand edge rather than two ragged ones.
                    col.Item().PaddingTop(14).ShowEntire().AlignRight().Width(260).Column(c =>
                    {
                        void Line(string label, string value, bool bold = false, string? colour = null)
                        {
                            c.Item().PaddingVertical(2).Row(r =>
                            {
                                r.RelativeItem().Text(label)
                                    .FontSize(8).SemiBold().FontColor(Colors.Grey.Darken2);
                                var t = r.ConstantItem(110).AlignRight()
                                    .Text(value).FontSize(bold ? 11 : 9);
                                if (bold) t.Bold();
                                if (colour != null) t.FontColor(colour);
                            });
                        }

                        Line("This order", Money(order.EffectiveValue));

                        // Advance and balance are positions on the customer's FULL
                        // account, not on this order alone — say so, otherwise the
                        // numbers look wrong next to a single order's total.
                        if (summary.OrderCount > 1)
                        {
                            c.Item().PaddingTop(4).PaddingBottom(2)
                                .Text($"Across all {summary.OrderCount} orders")
                                .FontSize(7).Italic().FontColor(Colors.Grey.Darken1);
                            Line("Total order value", Money(summary.LeadTotal));
                        }

                        c.Item().PaddingVertical(4).LineHorizontal(1).LineColor(Colors.Grey.Lighten1);

                        Line("Advance received", Money(summary.TotalAdvance));
                        Line("Balance due", Money(summary.Balance), bold: true);
                    });

                    if (!string.IsNullOrWhiteSpace(order.Notes))
                    {
                        col.Item().PaddingTop(18).Column(c =>
                        {
                            c.Item().Text("NOTES").FontSize(7).Bold().FontColor(Colors.Grey.Darken1);
                            c.Item().PaddingTop(2).Text(order.Notes).FontSize(8);
                        });
                    }
                });

                page.Footer().Column(col =>
                {
                    col.Item().LineHorizontal(1).LineColor(Colors.Grey.Lighten2);
                    col.Item().PaddingTop(5).Row(row =>
                    {
                        row.RelativeItem().AlignRight().Text(t =>
                        {
                            t.DefaultTextStyle(s => s.FontSize(7).FontColor(Colors.Grey.Medium));
                            t.Span("Page ");
                            t.CurrentPageNumber();
                            t.Span(" of ");
                            t.TotalPages();
                        });
                    });
                });
            });
        });

        await Task.Run(() => document.GeneratePdf(absolutePath));

        _logger.LogInformation("Generated Sales Order PDF for order {OrderNumber} at {Path}",
            order.OrderNumber, relativePath);

        return relativePath;
    }

    private static string Dash(string? value) => string.IsNullOrWhiteSpace(value) ? "—" : value;

    private static string Money(decimal value) => "₹" + value.ToString("N2", Inr);

    /// <summary>
    /// The product photo for a line, or null when there isn't one we can use.
    ///
    /// Never throws. A Sales Order is the customer's commercial record; a photo
    /// that has been deleted, moved, or written as a half-finished upload must
    /// cost the thumbnail, not the document.
    /// </summary>
    private byte[]? LoadProductImage(string? storedPath)
    {
        var relative = UploadPaths.ToRelative(storedPath);
        if (string.IsNullOrWhiteSpace(relative)) return null;

        try
        {
            var absolute = UploadPaths.Absolute(relative);
            if (!File.Exists(absolute)) return null;

            // A 10 MB catalogue photo per line would make the PDF unsendable over
            // WhatsApp; the upload cap is 10 MB, so guard rather than assume.
            var info = new FileInfo(absolute);
            if (info.Length == 0 || info.Length > 6 * 1024 * 1024)
            {
                _logger.LogWarning("Skipping product image {Path} in SO: {Bytes} bytes", relative, info.Length);
                return null;
            }

            return File.ReadAllBytes(absolute);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Could not read product image {Path} for the Sales Order", relative);
            return null;
        }
    }
}
