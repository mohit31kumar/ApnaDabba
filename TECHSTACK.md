# APNADABBA - OFFICIAL TECHNOLOGY STACK & DEVELOPMENT STANDARDS

## Objective

This document defines the official technology stack, architecture, development standards, coding conventions, and engineering guidelines for the ApnaDabba platform.

All future planning, architecture decisions, feature development, database design, API design, authentication, deployment, and documentation must strictly follow this standard unless explicitly changed through a documented architecture review.

---

# 1. System Overview

ApnaDabba will be developed as a multi-platform food ordering and delivery ecosystem consisting of:

1. Customer Mobile Application
2. Delivery Partner Mobile Application
3. Admin Web Dashboard
4. Backend API & Realtime Services
5. Shared Business Logic & Validation Layer

The architecture must prioritize:

* Scalability
* Maintainability
* Reusability
* Security
* Performance
* Developer Productivity

---

# 2. Official Technology Stack

## Customer Mobile Application

Framework:

* React Native (Expo)

Language:

* TypeScript

State Management:

* Zustand

Server State:

* TanStack Query (React Query)

Navigation:

* React Navigation

Forms:

* React Hook Form

Validation:

* Zod

Realtime:

* Socket.IO Client

Push Notifications:

* Firebase Cloud Messaging (FCM)

Maps:

* Google Maps

Image Handling:

* Expo Image Picker

Storage:

* SecureStore for sensitive data
* AsyncStorage for non-sensitive cached data

---

## Delivery Partner Mobile Application

Framework:

* React Native (Expo)

Language:

* TypeScript

State Management:

* Zustand

Server State:

* TanStack Query

Navigation:

* React Navigation

Validation:

* Zod

Realtime:

* Socket.IO Client

Location Tracking:

* Expo Location
* Google Maps

Push Notifications:

* Firebase Cloud Messaging

---

## Admin Dashboard

Framework:

* React + Vite

Language:

* TypeScript

UI:

* Tailwind CSS

Routing:

* React Router

State Management:

* Zustand

Server State:

* TanStack Query

Forms:

* React Hook Form

Validation:

* Zod

Realtime:

* Socket.IO Client

Charts:

* Recharts

Tables:

* TanStack Table

---

## Backend

Runtime:

* Node.js

Framework:

* Express.js

Language:

* TypeScript

Database:

* MySQL

ORM:

* Sequelize

Authentication:

* JWT Access Tokens
* Refresh Tokens

Password Security:

* bcrypt

Realtime:

* Socket.IO

Caching:

* Redis

File Storage:

* Cloudinary

Email Service:

* Nodemailer

API Documentation:

* Swagger/OpenAPI

Validation:

* Zod

Logging:

* Winston

Environment Management:

* dotenv

---

# 3. Shared Standards

## Shared Validation Schemas

Validation rules must not be duplicated.

Create shared schemas for:

* Login
* Registration
* Subscriptions
* Deliveries
* Addresses
* Customers
* Payments
* Wallet Transactions

Use:

* Zod

Validation logic should remain identical across:

* Mobile Apps
* Admin Dashboard
* Backend

---

## Shared Types

Create shared TypeScript interfaces for:

* User
* Customer
* Driver
* Subscription
* Delivery
* Address
* Wallet
* Payment
* Notification

Never duplicate type definitions.

---

# 4. Folder Architecture

## Backend

src/

* config/
* controllers/
* services/
* repositories/
* middlewares/
* routes/
* validators/
* sockets/
* models/
* utils/
* jobs/
* docs/

Rule:

Controllers must be thin.

Business logic belongs inside Services.

Database logic belongs inside Repositories.

---

## React Native Apps

src/

* api/
* assets/
* components/
* screens/
* navigation/
* hooks/
* services/
* store/
* validations/
* types/
* utils/
* constants/

---

## Admin Dashboard

src/

* api/
* components/
* pages/
* layouts/
* routes/
* hooks/
* services/
* store/
* validations/
* types/
* utils/

---

# 5. API Standards

## REST Naming Convention

Good:

GET /api/orders

GET /api/orders/:id

POST /api/orders

PATCH /api/orders/:id

DELETE /api/orders/:id

Bad:

GET /api/getOrders

POST /api/createOrder

---

## Response Format

Success:

{
"success": true,
"message": "Order created successfully",
"data": {}
}

Error:

{
"success": false,
"message": "Order not found"
}

---

# 6. Authentication Standards

Access Token:

* Short expiry

Refresh Token:

* Long expiry

Storage:

Mobile:

* SecureStore

Web:

* HttpOnly Cookies

Never store tokens in LocalStorage.

Never expose sensitive user information.

---

# 7. Realtime Standards

Socket.IO will handle:

* Delivery Dispatch Events
* Driver Assignment Events
* Delivery Tracking (GPS)
* Delivery Status Updates
* Driver Location Updates
* Notifications

All realtime events must be documented.

---

# 8. Database Standards

Database:

* MySQL

Naming:

Tables:

* snake_case

Columns:

* snake_case

Primary Keys:

* id

Foreign Keys:

* entity_id

Examples:

users

drivers

subscriptions

deliveries

wallet_transactions

Never use inconsistent naming.

---

# 9. Code Quality Standards

Use:

* ESLint
* Prettier

Rules:

* No duplicated logic
* No hardcoded values
* No business logic in controllers
* No direct DB access inside routes
* No console.log in production

Every feature must include:

* Validation
* Error Handling
* Logging

---

# 10. Scalability Standards

All new features must support:

* High subscription volume (100K+ customers, 1K+ drivers)
* Multiple cities
* Multiple delivery partners
* High order volume
* Future mobile expansion

Avoid architecture decisions that limit future growth.

---

# 11. Deployment Standards

Frontend:

* Vercel

Backend:

* VPS / AWS / DigitalOcean

Database:

* Managed MySQL

Redis:

* Managed Redis

Images:

* Cloudinary

Environment variables must never be committed to Git.

---

# 12. Project Structure

The project uses a **Turborepo monorepo**:

```
apnadabba/
├── packages/
│   └── shared/             — Zod schemas, TypeScript types, constants
├── apps/
│   ├── server/             — Node.js + Express + Sequelize backend
│   ├── admin/              — React + Vite admin dashboard
│   ├── mobile-customer/    — React Native (Expo) customer app
│   └── mobile-driver/      — React Native (Expo) driver app
├── package.json            — Root workspace config
└── turbo.json              — Turborepo pipeline config
```

Validation logic and type definitions live in `packages/shared/` and are consumed by all apps via workspace references. Never duplicate validation or type definitions.

---

# 13. Development Rule For AI

When generating code, documentation, architecture, APIs, database schemas, feature plans, or implementation strategies for ApnaDabba:

1. Always follow this technology stack.
2. Always follow these folder structures.
3. Always use TypeScript on frontend projects.
4. Prefer reusable components.
5. Prefer service-layer architecture.
6. Design for scalability.
7. Avoid unnecessary complexity.
8. Generate production-grade code.
9. Follow security best practices.
10. Ensure compatibility with React Native (Expo), React + Vite, Node.js, Express, MySQL, Socket.IO, Redis, and shared TypeScript models.

This document is the authoritative development standard for the ApnaDabba platform.
