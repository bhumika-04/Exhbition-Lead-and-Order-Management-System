using System.Globalization;
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

        // A GUID in the filename keeps the PDF unguessable: /uploads is served
        // without authentication (Interakt must be able to fetch it by URL),
        // so a predictable name would expose every customer's order document.
        var fileName = $"{order.OrderNumber}-{Guid.NewGuid():N}.pdf";
        var relativePath = Path.Combine("orders", order.LeadId.ToString(), fileName)
                               .Replace('\\', '/');

        var absoluteDir = Path.Combine(_env.ContentRootPath, "uploads", "orders", order.LeadId.ToString());
        Directory.CreateDirectory(absoluteDir);
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
                                c.Item().Text(sellerName).FontSize(15).Bold();
                            if (!string.IsNullOrWhiteSpace(sellerAddress))
                                c.Item().Text(sellerAddress).FontSize(8).FontColor(Colors.Grey.Darken1);
                            if (!string.IsNullOrWhiteSpace(sellerPhone))
                                c.Item().Text(sellerPhone).FontSize(8).FontColor(Colors.Grey.Darken1);
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
                        row.RelativeItem().Column(c =>
                        {
                            c.Item().Text("BILL TO").FontSize(7).Bold().FontColor(Colors.Grey.Darken1);
                            c.Item().PaddingTop(2).Text(order.LeadName ?? "—").FontSize(11).Bold();
                            if (!string.IsNullOrWhiteSpace(order.LeadCompanyName))
                                c.Item().Text(order.LeadCompanyName);
                            if (!string.IsNullOrWhiteSpace(order.LeadPhone))
                                c.Item().Text(order.LeadPhone).FontColor(Colors.Grey.Darken2);
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
                    col.Item().Table(table =>
                    {
                        table.ColumnsDefinition(c =>
                        {
                            c.ConstantColumn(20);   // #
                            c.RelativeColumn(2.0f); // item
                            c.RelativeColumn(1.9f); // barcode
                            c.RelativeColumn(1.0f); // size
                            c.RelativeColumn(1.2f); // colour
                            c.ConstantColumn(34);   // pcs
                            c.RelativeColumn(1.5f); // rate
                            c.RelativeColumn(1.6f); // amount
                        });

                        table.Header(header =>
                        {
                            void H(string text, bool right = false)
                            {
                                var cell = header.Cell().Background(Colors.Grey.Lighten3).Padding(5);
                                (right ? cell.AlignRight() : cell)
                                    .Text(text).FontSize(7).Bold().FontColor(Colors.Grey.Darken3);
                            }

                            H("#"); H("ITEM"); H("BARCODE"); H("SIZE");
                            H("COLOUR"); H("PCS", true); H("RATE", true); H("AMOUNT", true);
                        });

                        foreach (var item in order.Items)
                        {
                            IContainer Cell() => table.Cell()
                                .BorderBottom(1).BorderColor(Colors.Grey.Lighten2).Padding(5);

                            Cell().Text(item.LineNumber.ToString()).FontColor(Colors.Grey.Darken1);
                            Cell().Text(item.ItemType).Bold();
                            Cell().Text(Dash(item.Barcode)).FontSize(8);
                            Cell().Text(Dash(item.Size));
                            Cell().Text(Dash(item.Colour));
                            Cell().AlignRight().Text(item.Pieces.ToString());
                            // Rate is optional — an unpriced line shows a dash rather
                            // than a misleading ₹0.00.
                            Cell().AlignRight().Text(item.Rate.HasValue ? Money(item.Rate.Value) : "—");
                            Cell().AlignRight().Text(item.Amount.HasValue ? Money(item.Amount.Value) : "—").Bold();

                            // Customization spans the full width beneath its line
                            if (!string.IsNullOrWhiteSpace(item.Customization))
                            {
                                table.Cell().ColumnSpan(8)
                                    .BorderBottom(1).BorderColor(Colors.Grey.Lighten2)
                                    .PaddingLeft(25).PaddingBottom(5)
                                    .Text($"Customization: {item.Customization}")
                                    .FontSize(8).Italic().FontColor(Colors.Grey.Darken2);
                            }
                        }
                    });

                    // ── Totals ──────────────────────────────────────────
                    col.Item().PaddingTop(14).AlignRight().Width(250).Column(c =>
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
                        row.RelativeItem().Text("Barcodes are verified against the ERP catalogue.")
                            .FontSize(7).FontColor(Colors.Grey.Medium);
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
}
