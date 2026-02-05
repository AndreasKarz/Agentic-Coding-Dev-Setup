---
applyTo: "**"
---

# Project general coding standards
- Prefix private class members with underscore
- Use explicit type declarations over implicit typing throughout the codebase (do not use `var` unless the type is obvious)
- Avoid abbreviated variable names - use descriptive full names

# Application Structure

## Architecture Overview
This is a Fusion Backend application following micro-service-oriented architecture with MongoDB as the primary database. 
The system is organized into domain-specific services, each containing their own business logic, data access, and API layers.

## Technology Stack
- **API**: ASP.NET Core with HotChocolate for GraphQL
- **Database**: MongoDB with MongoDB.Driver / in rare cases SQL Server with Entity Framework Core
- **Messaging**: Azure Service Bus through a Masstransit abstraction
- **Workflows**: WorkflowCore
- **Caching**: Redis (StackExchange.Redis) with memory caching fallback
- **Background Jobs**: Quartz.NET with MongoDB persistence

### Project Structure
```
Fusion-Backend/
├── .github/
│   └── instructions/           # Coding standards and guidelines
├── src/
│   ├── Api/                    # Stitching layer for all domain services
│   ├── <domain-1>/             # Domain-specific service area
│   │   ├── src/
│   │   │   ├── Abstractions/   # Domain interfaces and contracts
│   │   │   ├── Core/           # Business logic and application services
│   │   │   ├── DataAccess/     # Data persistence and repositories
│   │   │   ├── GraphQL/        # GraphQL API layer
│   │   │   ├── Host/           # API hosting and startup configuration
│   │   │   ├── Worker/         # Background services and workers
│   │   │   └── Migrations.Implementation/ # Database migrations
│   │   └── test/
│   │       ├── Core.Tests/     # Business logic unit tests
│   │       ├── DataAccess.Tests/ # Repository integration tests
│   │       ├── GraphQL.Tests/  # API layer tests
│   │       ├── Worker.Tests/   # Worker service tests
│   │       └── System.Tests/   # End-to-end integration tests
│   ├── <domain-2>/             # Domain-specific service area
│   │   ├── src/...
│   │   └── test/...
│   └── Shared/                 # Cross-cutting shared utilities
├── docs/...                    # Project documentation
└── tools/...                   # Build and development tools
```

## Layer Definitions
- **Abstractions**: Interfaces, contracts, and domain models, enums, shared types, etc.
- **Core**: Business logic, application services, and domain implementations
- **DataAccess**: Data persistence, repositories, and database context
- **GraphQL**: API layer with HotChocolate, resolvers, and type definitions
- **Host**: API hosting, startup configuration, and dependency injection setup
- **Worker**: Background services, message handlers, and batch processing
- **Migrations.Implementation**: Database schema migrations and data updates

## Dependency Rules
- `Core` ↠ `Abstractions`
- `DataAccess` ↠ `Abstractions`, `Core`
- `GraphQL` ↠ `Abstractions`, `Core`
- `Host` ↠ `Abstractions`, `Core`
- `Worker` ↠ `Abstractions`, `Core`
- Test projects follow same dependency rules as production code

### GraphQL API Structure
- Api represents the stitching layer for all domain services
- HotChocolate for GraphQL implementation
- Resolvers following clean architecture principles
- Input/output types separate from domain entities
- Use Input/output types over prior to separate parameters
- Prefer implementation-firsta approach over schema-first
- Leverage HotChocolate's built-in mutation conventions for consistent error handling and response patterns 
