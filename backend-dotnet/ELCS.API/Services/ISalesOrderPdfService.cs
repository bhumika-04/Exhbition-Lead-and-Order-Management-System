namespace ELCS.API.Services;

public interface ISalesOrderPdfService
{
    /// <summary>
    /// Renders the Sales Order PDF for a confirmed order and writes it under
    /// uploads/orders/{leadId}/. Returns the path relative to the uploads root
    /// (e.g. "orders/42/SO-202608-00007-3f9a....pdf") so it can be turned into
    /// a public URL for WhatsApp media delivery.
    /// </summary>
    Task<string> GenerateAsync(OrderDetailDto order);
}
