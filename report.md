# APNADABBA

# BUSINESS REQUIREMENTS DOCUMENT (BRD)

Version: 1.0
Status: Draft
Prepared For: ApnaDabba Platform
Document Type: Business Requirements Document

---

# 1. EXECUTIVE SUMMARY

ApnaDabba is a subscription-based tiffin management platform designed to digitize and automate the complete lifecycle of a recurring meal delivery business.

Unlike traditional food delivery applications that focus on one-time ordering, ApnaDabba focuses on recurring meal subscriptions, customer wallet management, delivery execution, tiffin recovery tracking, driver operations, and business process automation.

The platform enables customers to subscribe to meal plans, maintain prepaid meal wallets, schedule and skip meals, receive daily deliveries, and manage their subscription lifecycle through a unified dashboard.

For the business operator, the platform provides automated delivery generation, driver assignment, wallet accounting, tiffin tracking, operational monitoring, and reporting capabilities.

The objective is to eliminate manual record keeping and create a scalable operational framework for subscription-based tiffin services.

---

# 2. BUSINESS OBJECTIVE

The primary objective of ApnaDabba is to create a centralized system that manages:

1. Customer onboarding
2. Subscription lifecycle management
3. Meal scheduling
4. Delivery execution
5. Driver operations
6. Wallet accounting
7. Tiffin asset tracking
8. Operational reporting
9. Business automation

The platform should reduce operational dependency on spreadsheets, manual registers, WhatsApp tracking, and paper-based accounting systems.

---

# 3. PROBLEM STATEMENT

Traditional tiffin businesses face several operational challenges:

## Customer Challenges

* No visibility into meal schedules
* No mechanism to skip meals before delivery
* No transparency regarding remaining balance
* No access to delivery history
* Manual communication required for subscription changes

## Business Challenges

* Manual subscription tracking
* Manual wallet calculations
* Delivery assignment difficulties
* Missed delivery records
* Difficulty tracking tiffin returns
* Lack of operational visibility
* Revenue leakage due to poor accounting controls

## Driver Challenges

* No centralized delivery list
* No proof of completed deliveries
* Manual communication with administrators
* Lack of route visibility

ApnaDabba aims to solve these challenges through a structured workflow-driven platform.

---

# 4. BUSINESS MODEL

ApnaDabba operates on a prepaid subscription model.

The customer subscribes to a meal plan and maintains a wallet balance.

The system generates deliveries according to subscription rules.

Wallet deduction occurs only after successful delivery confirmation.

This ensures that customers are charged only for meals actually delivered.

---

# 5. STAKEHOLDERS

## Customer

Consumes meal services.

Responsibilities:

* Purchase subscription
* Maintain wallet balance
* Manage delivery address
* Skip meals before cutoff
* Track deliveries
* Monitor wallet balance

---

## Delivery Boy

Responsible for physical meal delivery.

Responsibilities:

* View assigned deliveries
* Deliver meals
* Mark deliveries completed
* Follow assigned route schedule

---

## Administrator

Manages platform operations.

Responsibilities:

* Manage plans
* Manage subscriptions
* Manage deliveries
* Manage drivers
* Monitor wallets
* Resolve operational issues
* Reverse incorrect delivery actions
* Monitor tiffin recovery

---

## System

Automated engine responsible for:

* Delivery generation
* Driver assignment
* Wallet calculations
* Notifications
* Scheduled jobs
* Operational validations

---

# 6. SYSTEM OVERVIEW

The platform consists of four major operational domains:

## Domain 1 – Customer Operations

Responsible for:

* Registration
* Authentication
* Subscription purchase
* Wallet management
* Delivery visibility
* Skip meal requests

---

## Domain 2 – Delivery Operations

Responsible for:

* Delivery creation
* Delivery assignment
* Delivery execution
* Delivery completion
* Delivery correction

---

## Domain 3 – Financial Operations

Responsible for:

* Wallet management
* Security deposits
* Meal deductions
* Refund processing
* Transaction history

---

## Domain 4 – Asset Recovery Operations

Responsible for:

* Tiffin tracking
* Outstanding tiffin monitoring
* Recovery enforcement
* Customer blocking rules

---

# 7. USER ROLES

The platform supports the following user roles:

## CUSTOMER

Permissions:

* View subscription
* View wallet
* View deliveries
* Skip meals
* Manage profile

---

## DELIVERY_BOY

Permissions:

* View assigned deliveries
* Mark deliveries completed

Restrictions:

* Cannot manage subscriptions
* Cannot modify wallet balances
* Cannot reverse deliveries

---

## ADMIN

Permissions:

* Full operational access
* Subscription management
* Driver management
* Wallet operations
* Delivery corrections
* Reporting access

---

## SYSTEM

Automated role used internally.

Responsible for:

* Delivery generation
* Assignment engine
* Scheduled processing
* Validation checks
* Notification triggers

---

