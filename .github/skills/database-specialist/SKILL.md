---
name: database-specialist
description: "Spezialist für Datenbankarbeit im SyncHub-Projekt — MS SQL Server mit Stored Procedures, MongoDB Atlas Cluster mit MongoDB.Driver, Change-Tracker-Pipelines, Data-Loader-Konfigurationen und Datenbank-Tests mit Squadron. Triggers: SqlClient, SqlConnection, SqlCommand, StoredProcedure, SqlExecutionContext, SqlChangeTracker, SqlDataLoader, IMongoCollection, BsonDocument, MongoConventions, SourceRepository, DomainEntityRepository, BulkWriteAsync, IAsyncCursor, MongoResource, SqlServerResource, SyncHub_Database, SyncHub_Connections, ConnectionsOptions, MongoDB-Indexing, Change-Tracker-Cron, Quartz-Scheduling."
---

# Database Specialist — SyncHub

Leitfaden für alle Datenbankarbeiten im SyncHub-Projekt. Deckt MS SQL Server (Stored Procedures, Change Tracking) und MongoDB Atlas (Repositories, Indexing, Bulk Operations) ab.

> **Scope**: Dieses Skill behandelt SyncHub-spezifische Datenbankpatterns. Für allgemeine Backend-Patterns (GraphQL, MassTransit, Startup) → `backend-developer` Skill. Für Testkonventionen → `tests.instructions.md`.

## Architektur-Überblick

SyncHub ist eine Datenpipeline, die Quelldaten (MS SQL) in eine MongoDB-Zieldatenbank synchronisiert:

```
SQL Server (Stored Procedures)
  → SqlChangeTracker (Quartz-Job, Cron)
    → Keys extrahieren
      → MongoDB (Keys, Transactions speichern)
        → DomainProcessor (Transformation)
          → MongoDB (Snapshots, Hashes speichern)
```

### Relevante Pfade im Repo

| Bereich | Pfad |
|---|---|
| SQL-Client & Execution | `src/DataAccess/` |
| SQL-Konfigurationen | `src/Abstractions/Configuration/` |
| Change Tracker & Loader | `src/Core/ChangeTracker/`, `src/Core/Loader/` |
| MongoDB-Repositories | `src/Repository/` |
| DI-Registrierung | `src/Core/SyncHubCoreCollectionExtensions.cs` |
| Domain-Konfiguration | `src/Repository/ConfigureDomainSettings.cs` |
| Tests | `test/` |

## MS SQL Server

### SqlClient — Kern der SQL-Ausführung

`SqlClient.cs` in `src/DataAccess/` nutzt `Microsoft.Data.SqlClient` (nicht `System.Data.SqlClient`). Key-Eigenschaften:

- `CommandType.StoredProcedure` — ausschliesslich Stored Procedures, kein Inline-SQL
- `CommandTimeout` = 10 Minuten
- Polly `WaitAndRetry(3, retryAttempt => TimeSpan.FromSeconds(5))` für transiente Fehler
- Streaming via `IAsyncEnumerable<SqlTable>` mit optionalem Batching

```csharp
// Vereinfachtes Pattern aus SqlClient.cs
await using SqlConnection connection = new(context.ConnectionString);
await connection.OpenAsync(cancellationToken);

await using SqlCommand command = new(context.StoredProcedure, connection)
{
    CommandType = CommandType.StoredProcedure,
    CommandTimeout = (int)TimeSpan.FromMinutes(10).TotalSeconds
};

// Parameter hinzufügen
foreach (SqlParameter parameter in context.Parameters)
{
    command.Parameters.Add(parameter);
}

await using SqlDataReader reader = await command.ExecuteReaderAsync(cancellationToken);
```

### SqlExecutionContext

Internes Kontextobjekt für SQL-Aufrufe:

```csharp
internal class SqlExecutionContext
{
    public string ConnectionString { get; set; }
    public string StoredProcedure { get; set; }
    public IList<SqlParameter> Parameters { get; set; }
    public bool UseBatching { get; set; }
    public int BatchSize { get; set; }
}
```

### Zwei SQL-Client-Typen

| Client | Implementiert | Batching | Zweck |
|---|---|---|---|
| `SqlChangeTrackerClient` | `ISqlChangeTrackerClient` | Ja | Periodische Änderungserkennung via Cron |
| `SqlDataLoaderClient` | `ISqlDataLoaderClient` | Nein | Vollladen von Entitätendaten |

Beide erstellen ein `SqlExecutionContext` aus ihrer jeweiligen Konfiguration.

### SQL-Konfigurationen

#### SqlChangeTrackerConfiguration

Implementiert `IChangeTrackerConfiguration`:

```csharp
public class SqlChangeTrackerConfiguration : IChangeTrackerConfiguration
{
    public string StoredProcedure { get; set; }
    public string QueryParameterName { get; set; }
    public string QueryParameterType { get; set; }
    public long InitialTransactionId { get; set; }
    public string ResultPrimaryKeyColumnName { get; set; }
    public string ResultTransactionIdColumnName { get; set; }
    public string ConnectionString { get; set; }
    public string CronSchedule { get; set; } = "0 {0} * ? * * *";
    public EntityAction EntityAction { get; set; }

    public void Resolve(ConnectionsOptions options)
    {
        // Löst ConnectionString über ConnectionsOptions auf
    }
}
```

- `CronSchedule` Default: `"0 {0} * ? * * *"` — Platzhalter `{0}` wird durch Minute ersetzt
- `Resolve(ConnectionsOptions)` — Verbindungsstring aus benannter Konfiguration auflösen

#### SqlLoaderConfiguration

Implementiert `ILoaderConfiguration`:

```csharp
public class SqlLoaderConfiguration : ILoaderConfiguration
{
    public string StoredProcedure { get; set; }
    public string ResultPrimaryKeyColumnName { get; set; }
    public string QueryParameterName { get; set; }
    public string QueryParameterType { get; set; }
    public string QueryParameterTypeName { get; set; }  // Für TVP-Support
    public string ConnectionString { get; set; }

    public void Resolve(ConnectionsOptions options) { /* ... */ }
}
```

### Verbindungsauflösung

Verbindungsstrings werden **nicht** direkt in Konfigurationen gespeichert, sondern über `ConnectionsOptions` aufgelöst:

```
Config-Sektion: SyncHub_Connections
  → ConnectionsOptions (Name/Value-Paare)
    → Loader/Tracker rufen Resolve(ConnectionsOptions) auf
```

## Change Tracker Pipeline

### SqlChangeTracker

Registriert Quartz-Jobs mit Cron-Scheduling:

```csharp
// Vereinfachtes Pattern
JobBuilder.Create<SqlChangeTrackerJob>()
    .WithIdentity(jobKey)
    .Build();

TriggerBuilder.Create()
    .WithCronSchedule(cronExpression)
    .Build();
```

### SqlChangeTrackerJob

Attribute: `[DisallowConcurrentExecution, PersistJobDataAfterExecution]`

Erweitert `TrackableJob`. Pipeline-Ablauf:

1. Domain-Konfiguration laden
2. Aktuelle Transaction-ID aus MongoDB holen
3. Stored Procedure mit Transaction-ID ausführen
4. Geänderte Keys extrahieren
5. Keys in MongoDB speichern (`{entity}_keys`)
6. Neue Transaction-ID in MongoDB speichern (`{entity}_transactions`)
7. DomainProcessor triggern

OpenTelemetry-Tracing mit `Activity` und `synchub.changetracker.*`-Tags ist obligatorisch.

### Domain-Konfiguration

`ConfigureDomainSettings.cs` nutzt `_t`-Diskriminator-Feld für polymorphe Typ-Auflösung:

```
DomainSettings:Configurations → Array von Konfigurationen
  → _t-Feld bestimmt den Typ:
    - SqlLoaderConfiguration
    - RestLoaderConfiguration
    - GraphQLLoaderConfiguration
    - SqlChangeTrackerConfiguration
    - ServiceBusChangeTrackerConfiguration
    - FieldKeyServiceBusChangeTrackerConfiguration
```

### Konfigurations-Sektionen

| Sektion | Zweck |
|---|---|
| `SyncHub_Connections` | Benannte Verbindungsstrings (Name/Value) |
| `SyncHub_Database` | MongoDB ConnectionString + DatabaseName |
| `SyncHub_Messaging` | Service-Bus-Konfiguration |
| `SyncHub_Audit` | Audit-Einstellungen |
| `DomainSettings:Configurations` | Loader- und Tracker-Definitionen |
| `DomainSettings:HostSettings` | Host-spezifische Einstellungen |

## MongoDB Atlas

### MongoConventions

**Jedes Repository** muss `MongoConventions.Init()` im statischen Konstruktor aufrufen:

```csharp
public class MyRepository
{
    static MyRepository()
    {
        MongoConventions.Init();
    }
}
```

### Collection-Namenskonvention

Collections werden dynamisch nach Entity-Typ benannt:

| Collection | Pattern | Zweck |
|---|---|---|
| `{EntityType.Name}_snapshots` | Typisiert (`Snapshot`) | Domain-Entity-Snapshots |
| `{EntityType.Name}_keys` | `BsonDocument` | Source-Entity-Keys-Queue |
| `{EntityType.Name}_transactions` | `BsonDocument` | Change-Tracker-Transaktionen |
| `{EntityType.Name}_audit_keys` | Typisiert (`PipelineAuditEntry`) | Pipeline-Audit-Einträge |
| `{EntityType.Name}_hashes` | Legacy | Hash-Speicher (Legacy) |
| `__domains` | Typisiert (`DomainConfiguration`) | Domain-Konfigurationen |
| `__settings` | Typisiert (`HostSettings`) | Host-Einstellungen |

Systemcollections (`__domains`, `__settings`) haben doppelten Unterstrich als Präfix.

### SourceRepository — BsonDocument-basiert

Arbeitet mit `IMongoCollection<BsonDocument>` für `_transactions` und `_keys`:

```csharp
// Index-Erstellung
CreateIndexModel<BsonDocument> index = new(
    Builders<BsonDocument>.IndexKeys
        .Ascending("SourceIdentifier")
        .Ascending("Disabled")
        .Ascending("TransactionId"),
    new CreateIndexOptions { Background = true });

// Bulk-Operationen für Löschungen
List<DeleteOneModel<BsonDocument>> deletes = keys
    .Select(k => new DeleteOneModel<BsonDocument>(
        Builders<BsonDocument>.Filter.Eq("_id", k)))
    .ToList();

await collection.BulkWriteAsync(deletes, new BulkWriteOptions { IsOrdered = false });

// Deserialisierung
BsonSerializer.Deserialize<T>(document);
```

### DomainEntityRepository — Typisiert + BsonDocument

Verwaltet `_snapshots` und `_hashes` mit umfangreichem Index-Management:

```csharp
// Standard-Indexes
CreateIndexModel<Snapshot>[] indexes = new[]
{
    // Key-Index
    new CreateIndexModel<Snapshot>(
        Builders<Snapshot>.IndexKeys.Ascending(x => x.Key)),
    // Hash-Index
    new CreateIndexModel<Snapshot>(
        Builders<Snapshot>.IndexKeys.Ascending(x => x.Hash)),
    // Unique Key+Version
    new CreateIndexModel<Snapshot>(
        Builders<Snapshot>.IndexKeys
            .Ascending(x => x.Key)
            .Ascending(x => x.Version),
        new CreateIndexOptions { Unique = true })
};
```

Domain-spezifische Indexes auf `Entity.*`-Feldern werden zusätzlich erstellt.

#### Bulk-Upsert Pattern

```csharp
List<ReplaceOneModel<Snapshot>> updates = snapshots
    .Select(s => new ReplaceOneModel<Snapshot>(
        Builders<Snapshot>.Filter.Eq(x => x.Key, s.Key),
        s) { IsUpsert = true })
    .ToList();

await collection.BulkWriteAsync(updates);
```

#### IAsyncCursor für Streaming

Für grosse Datenmengen:

```csharp
using IAsyncCursor<BsonDocument> cursor = await collection
    .FindAsync(filter, new FindOptions<BsonDocument> { BatchSize = 1000 });

while (await cursor.MoveNextAsync(cancellationToken))
{
    foreach (BsonDocument document in cursor.Current)
    {
        // Verarbeitung
    }
}
```

> **Kompatibilitätshinweis**: `$literal`-Syntax vermeiden — nicht unterstützt auf MongoDB Server < 4.4 mit MongoDB.Driver > 3.x.

### ConfigurationRepository — Caching

Nutzt `IMemoryCache` mit 1-Tag-Ablauf:

```csharp
_memoryCache.GetOrCreateAsync(cacheKey, entry =>
{
    entry.AbsoluteExpirationRelativeToNow = TimeSpan.FromDays(1);
    return LoadFromMongoDB();
});
```

Unique-Index auf Domain-Name sichert Eindeutigkeit.

### AuditRepository

`IMongoCollection<PipelineAuditEntry>` für `_audit_keys` mit Compound-Index:

```csharp
Builders<PipelineAuditEntry>.IndexKeys
    .Ascending(x => x.Attempt)
    .Ascending(x => x.Key)
```

## DI-Registrierung

### Core-Services

```csharp
// SyncHubCoreCollectionExtensions.cs
services.AddSyncHubCore();  // SqlChangeTracker, ServiceBusChangeTracker, etc.

services.AddDomains<TDomainReference>();  // ConnectionsOptions, DomainsResolver
// → Registriert ConnectionsOptions aus SyncHub_Connections

services.AddScheduling();  // Quartz-Jobs: SqlChangeTrackerJob, AuditJob, DomainProcessorJob
```

### Relevante Config-Bindungen

```csharp
// ConnectionsOptions aus benannter Sektion
services.Configure<ConnectionsOptions>(
    configuration.GetSection("SyncHub_Connections"));
```

## Datenbank-Tests

### Squadron für Test-Infrastruktur

Nutze Squadron für echte Datenbankinstanzen in Tests:

| Resource | Zweck |
|---|---|
| `MongoResource` | Standalone MongoDB für einfache Tests |
| `MongoReplicaSetResource` | MongoDB Replica Set (für Transaktionen/Change Streams) |
| `SqlServerResource<SqlServerOptions>` | SQL Server Container |

```csharp
// MongoDB-Test-Setup
public class MyRepositoryTests : IClassFixture<MongoResource>
{
    private readonly IMongoDatabase _database;

    public MyRepositoryTests(MongoResource mongoResource)
    {
        _database = mongoResource.CreateDatabase();
    }
}
```

```csharp
// SQL Server-Test-Setup
public class MySqlTests : IClassFixture<SqlServerResource<SqlServerOptions>>
{
    public MySqlTests(SqlServerResource<SqlServerOptions> sqlResource)
    {
        string connectionString = sqlResource.ConnectionString;
    }
}
```

### System-Tests mit beiden Datenbanken

```csharp
public class SystemTests
    : IClassFixture<MongoResource>,
      IClassFixture<SqlServerResource<SqlServerOptions>>
{
    // Beide Datenbanken für End-to-End-Pipeline-Tests
}
```

### MongoDB-Fixtures laden

```csharp
// Datenbank aus JSON-Dateien erstellen
mongoResource.CreateDatabase(new CreateDatabaseFromFilesOptions
{
    // Fixture-Dateien für Test-Collections
});
```

### Test-Konfigurationsoverrides

```csharp
// Test-appsettings überschreiben
configuration["SyncHub_Database:ConnectionString"] = mongoResource.ConnectionString;
configuration["SyncHub_Database:DatabaseName"] = database.DatabaseNamespace.DatabaseName;
configuration["SyncHub_Connections:Values:0:Name"] = "MyConnection";
configuration["SyncHub_Connections:Values:0:Value"] = sqlResource.ConnectionString;
```

### Snapshooter für Ergebnisprüfung

Nutze `Snapshooter.Xunit` für deterministische Snapshot-Vergleiche:

```csharp
result.MatchSnapshot();
```

## Checkliste für neue Entities

Bei der Einrichtung einer neuen SyncHub-Entity:

1. **SQL Stored Procedure** — Sicherstellen, dass die SP existiert und die erwarteten Spalten liefert
2. **SqlLoaderConfiguration** — Loader-Konfiguration mit richtiger SP und Verbindung definieren
3. **SqlChangeTrackerConfiguration** — Tracker mit SP, Cron-Schedule und Verbindung definieren
4. **ConnectionsOptions** — Benannten Verbindungsstring in `SyncHub_Connections` registrieren
5. **MongoDB Collections** — Werden automatisch erstellt, aber Indexes prüfen
6. **Domain-spezifische Indexes** — Auf `Entity.*`-Feldern definieren, wenn Abfragen benötigt
7. **Tests** — Repository-Tests mit Squadron + Snapshooter, System-Tests mit beiden DBs
