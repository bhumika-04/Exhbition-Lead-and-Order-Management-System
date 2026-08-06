using Microsoft.Data.SqlClient;
using Dapper;

namespace ELCS.API.Data;

public interface IDbConnection
{
    SqlConnection CreateConnection();
}

public class DbConnectionFactory : IDbConnection
{
    private readonly string _connectionString;

    public DbConnectionFactory(IConfiguration config)
    {
        _connectionString = config.GetConnectionString("DefaultConnection")
            ?? throw new InvalidOperationException("Connection string not configured");
    }

    public SqlConnection CreateConnection()
    {
        return new SqlConnection(_connectionString);
    }
}
