# AI Development Guidelines - Cursor Rules and Documentation

This directory contains Cursor rules (`.mdc` files) and documentation for AI-assisted development of the busansashimi portfolio project.

---

## Project Structure Overview

```
busansashimi/
├── project/          # Main Next.js project (deployed service)
│   ├── amplify/      # AWS Amplify Gen 2 backend
│   ├── src/          # Source code
│   │   ├── app/      # Next.js App Router pages
│   │   ├── components/  # UI components (shadcn/ui)
│   │   ├── content/  # Article content
│   │   ├── hooks/    # Custom React hooks
│   │   ├── lib/      # Utilities and config
│   │   ├── types/    # TypeScript types
│   │   └── utils/    # API utilities
│   ├── system/       # Custom system components
│   └── public/       # Static assets
├── reference/        # v0-maintained design reference project
│   ├── app/          # Reference pages and components
│   ├── components/   # Reference UI components
│   └── ...
└── ai-dev/           # Cursor rules and documentation
    ├── *.mdc         # Cursor rule files
    ├── doc/          # Additional documentation
    └── README.md     # This file
```

---

## Cursor Rules (.mdc Files)

The following rule files are applied to guide AI-assisted development:

| File                             | Purpose                                                      |
| -------------------------------- | ------------------------------------------------------------ |
| `nextjs-typescript-tailwind.mdc` | Next.js, TypeScript, and Tailwind CSS development guidelines |
| `shadcn-nextjs.mdc`              | shadcn/ui and Next.js best practices                         |
| `tailwind.mdc`                   | Tailwind CSS conventions and patterns                        |
| `tailwind-shadcn.mdc`            | Tailwind + shadcn integration guidelines                     |
| `clean-code.mdc`                 | Clean code principles and readability                        |
| `code-quality.mdc`               | Code quality standards and error handling                    |
| `dev-log.mdc`                    | Automatic logging of operations to daily log files           |

---

## Directory Explanations

### project/

The main development project that is deployed as a production service.

```
project/
└── src/
    └── app/
        └── ...           # Project that is actually developed to deploy as a service
```

### reference/

A reference project maintained by v0 (Vercel's AI design tool) as a design reference. Use this directory to compare designs and component implementations.

```
reference/
└── app/
    └── ...               # Reference project that is maintained by v0 as design reference
```

---

## Tech Stack

### Frontend

- Next.js 15 (App Router)
- React 19
- TypeScript
- Tailwind CSS v4
- SCSS Modules
- shadcn/ui
- Radix UI

### Backend

- AWS Amplify Gen 2
- GraphQL (AWS AppSync)
- DynamoDB
- AWS Cognito (Authentication)

---

## Usage

1. **For AI-assisted development**: The `.mdc` files are automatically applied by Cursor to guide code generation and suggestions.

2. **For design reference**: Compare implementations between `project/` and `reference/` directories when working on UI components.

3. **For documentation**: Add additional documentation files to the `doc/` subdirectory as needed.

---

## Key Development Guidelines

- Use TypeScript for all code; prefer interfaces over types
- Use functional and declarative programming patterns
- Follow mobile-first responsive design with Tailwind CSS
- Minimize `use client`; favor React Server Components (RSC)
- Use descriptive variable names with auxiliary verbs (e.g., `isLoading`, `hasError`)
- Implement accessibility features on all interactive elements
- Handle errors and edge cases early with guard clauses
