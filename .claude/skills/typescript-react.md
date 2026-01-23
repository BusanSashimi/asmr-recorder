# TypeScript Best Practices with shadcn/ui and Next.js

## Code Style and Structure

- **Write concise, technical TypeScript code** with accurate examples
- **Use functional and declarative programming patterns**; avoid classes
- **Prefer iteration and modularization** over code duplication
- **Use descriptive variable names** with auxiliary verbs (e.g., `isLoading`, `hasError`)
- **Structure files**: exported component, subcomponents, helpers, static content, types

## Naming Conventions

- **Use lowercase with dashes for directories** (e.g., `components/auth-wizard`)
- **Favor named exports** for components

## TypeScript Usage

- **Use TypeScript for all code**; prefer interfaces over types
- **Avoid enums**; use maps instead
- **Use functional components with TypeScript interfaces**

## Syntax and Formatting

- **Use the `function` keyword** for pure functions
- **Avoid unnecessary curly braces** in conditionals; use concise syntax for simple statements
- **Use declarative JSX**

## Error Handling and Validation

- **Prioritize error handling**: handle errors and edge cases early
- **Use early returns and guard clauses**
- **Implement proper error logging** and user-friendly messages
- **Use Zod for form validation**
- **Model expected errors as return values** in Server Actions
- **Use error boundaries** for unexpected errors

## UI and Styling

- **Use Shadcn UI, Radix, and Tailwind Aria** for components and styling
- **Implement responsive design** with Tailwind CSS; use a mobile-first approach

## Performance Optimization

- **Minimize `use client`, `useEffect`, and `setState`**; favor React Server Components (RSC)
- **Wrap client components in Suspense** with fallback
- **Use dynamic loading** for non-critical components
- **Optimize images**: use WebP format, include size data, implement lazy loading

## Key Conventions

- **Use `nuqs` for URL search parameter state management**
- **Optimize Web Vitals** (LCP, CLS, FID)
- **Limit `use client`**:
  - **Favor server components and Next.js SSR**
  - **Use only for Web API access** in small components
  - **Avoid for data fetching or state management**
- **Follow Next.js docs** for Data Fetching, Rendering, and Routing

## Project Structure

- **Components**: Contains reusable UI components
- **App**: Next.js app for routing and server-side rendering
- **Hooks**: Custom React hooks for state management
- **Lib**: Utility functions and shared logic
- **Styles**: Tailwind CSS configuration and global styles
- **Data**: JSON and Markdown files for content management

## Development Guidelines

- Use **TypeScript** for type safety and maintainability
- Follow the coding standards defined in the **ESLint** configuration
- Ensure all components are **responsive** and **accessible**
- Use **Tailwind CSS** for styling, adhering to the defined color palette
- Write **JSDoc** comments for functions and components
- Use **React.memo** for pure function components to optimize performance
- Implement **lazy loading** for routing components
- Optimize **useEffect** dependencies to prevent unnecessary re-renders

## Testing Requirements

- Write unit tests using **Jest** and **React Testing Library**
- Ensure test coverage reaches at least **80%**
- Use **Snapshot Testing** for UI components to detect unintended changes

## Error Handling

- Use **try/catch** blocks to handle asynchronous operations
- Implement a **global error boundary** component to catch runtime errors
