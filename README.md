# Swaranjanam Carnatic Music Academy

Website and learning platform (LMS) for Swaranjanam Carnatic Music Academy — a
premium, traditional-feeling public site for prospective students, with a
student/teacher/admin LMS being added in phases. Initial scale: ~50–100 students.

## Technology stack

| Area | Choice |
| --- | --- |
| Framework | [Next.js](https://nextjs.org) 16.4 (App Router, Turbopack, Cache Components, Partial Prefetching) |
| UI | React 19.3, TypeScript (strict), Tailwind CSS v4, [shadcn/ui](https://ui.shadcn.com) (Radix), lucide-react |
| Auth & database | Firebase Authentication + Firestore *(planned)* |
| Media | Cloudinary *(planned)* |
| Payments | Razorpay, server-side order creation & verification *(planned)* |
| Hosting | Vercel |

> **Note for contributors:** Next.js 16.4 has breaking changes compared with
> older versions. Read the bundled guides in `node_modules/next/dist/docs/`
> before writing framework code (see `AGENTS.md`). In particular, with Cache
> Components enabled, request data (`cookies()`, `params`, etc.) must be read
> inside `<Suspense>`, and `new Date()` cannot run in prerendered output.

## Getting started

Requirements: Node.js 20+ and npm.

```bash
npm install
cp .env.example .env.local   # then fill in values as each phase needs them
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the development server |
| `npm run build` | Production build (also runs the TypeScript check) |
| `npm run start` | Serve the production build |
| `npm run lint` | Run ESLint |
| `npx tsc --noEmit` | Type-check without building |

## Environment variables

All variables are documented in [`.env.example`](.env.example), grouped by the
phase that needs them (site, Firebase client, Firebase Admin, Cloudinary,
Razorpay).

- Copy it to `.env.local` for local development. All `.env*` files except
  `.env.example` are git-ignored.
- On Vercel, add the same variables under **Project → Settings → Environment
  Variables**.
- Only `NEXT_PUBLIC_*` variables reach the browser. Admin keys, API secrets and
  webhook secrets must never use that prefix.
- Never commit real credentials or downloaded service-account JSON files.

The public site currently runs with no environment variables set.

## Project structure

```
src/
  app/
    layout.tsx            Root layout (fonts, metadata)
    globals.css           Design tokens, typography scale, decorative patterns
    not-found.tsx         Custom 404
    (public)/             Public pages sharing Navbar + Footer
      page.tsx            Home
      about/  contact/  login/  register/
      courses/            Catalogue and courses/[slug] detail pages
  components/
    ui/                   Primitives (shadcn-based + Container, Section, Modal, LoadingState…)
    course/               CourseCard, CourseBadge, CoursePrice, CourseRating, catalogue…
    layout/               Navbar, Footer, Logo, navigation
    home/  shared/  forms/  auth/  decor/
  config/site.ts          Site name, contact details, navigation
  data/                   Placeholder course catalogue and marketing copy
  lib/                    Data access (courses.ts), formatting, utilities
  types/                  Shared TypeScript types
```

Course data is read only through `src/lib/courses.ts`, so moving the catalogue
to Firestore will not require page changes.

## Current implementation status

**Done**

- Public site: Home, About, Courses (with category filter), Course detail
  (statically generated), Contact, Login, Register, 404.
- Design system: brand colour tokens, serif/sans typography scale, kolam and
  mandala decorative elements, reusable UI and course components.
- Responsive layout with mobile navigation.

**Placeholders (UI only)**

- Login, Register and Contact forms show a "coming soon" notice; nothing is
  submitted.
- "Enroll Now" opens an informational dialog; no checkout yet.
- Course catalogue, contact details, statistics and testimonials are sample
  content in `src/data/` and `src/config/site.ts` and must be replaced before
  launch.

**Planned (in order)**

1. Firebase setup (client + Admin SDK)
2. Authentication with server-side session cookies, roles, protected routes
3. Courses and lessons in Firestore
4. Student dashboard and lesson player
5. Admin dashboard (course management, manual enrolment)
6. Cloudinary media uploads
7. Teacher dashboard
8. Razorpay payments

## Learn more

- [Next.js documentation](https://nextjs.org/docs)
- [Deploying Next.js on Vercel](https://nextjs.org/docs/app/building-your-application/deploying)
