---
1. PRISMA VERSION

* ^7.8.0 (from package.json)

---
2. SCHEMA.PRISMA CONTENT

```prisma
// This is your Prisma schema file,
// learn more about it in the docs: https://pris.ly/d/prisma-schema

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id    Int     @id @default(autoincrement())
  email String  @unique
  name  String?
  password String
  role  String  @default("customer") // customer, admin, driver
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

---
3. DATASOURCE BLOCK

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

---
4. GENERATOR BLOCK

```prisma
generator client {
  provider = "prisma-client-js"
}
```

---
5. DOES prisma.config.ts EXIST?

* NO

---
6. DATABASE_URL

From .env:

* postgresql://neondb_owner:*****@ep-wispy-bar-an6avws5-pooler.c-6.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require

---
7. PROVIDER

* postgresql

---
8. LAST ERROR (IMPORTANT)

If any error appeared during:

* prisma generate
* migrate
* db push

LAST ERROR:
```
Error: The datasource.url property is required in your Prisma config file when using prisma migrate dev.
```

---
END
