# Swaranjanam Carnatic Music Academy

Website and learning platform (LMS) for Swaranjanam Carnatic Music Academy — a
premium, traditional-feeling public site for prospective students, with a
student/teacher LMS (courses, bilingual lessons, media uploads, enrollments, progress). Initial scale: ~50–100 students.

## Technology stack

| Area | Choice |
| --- | --- |
| Framework | [Next.js](https://nextjs.org) 16.4 (App Router, Turbopack, Cache Components, Partial Prefetching) |
| UI | React 19.3, TypeScript (strict), Tailwind CSS v4, [shadcn/ui](https://ui.shadcn.com) (Radix), lucide-react |
| Auth & database | Firebase Authentication (server-side session cookies) + Firestore |
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
| `npm run set-role -- <email> <teacher\|student>` | Grant or remove the teacher role (trusted machines only; see [docs/firebase-setup.md](docs/firebase-setup.md)) |
| `npm run migrate:courses -- [--dry-run] [--teacher=<email>] [--status=published\|draft]` | One-off import of the former static catalogue into Firestore (repeatable, never overwrites or duplicates) |

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

The public pages run without any variables. Sign-in, `/dashboard` and `/teacher`
need the Firebase variables — see **[docs/firebase-setup.md](docs/firebase-setup.md)**
for console configuration, key formatting, the teacher bootstrap process and Cloudinary setup.

## Project structure

```
src/
  app/
    layout.tsx            Root layout (fonts, metadata)
    globals.css           Design tokens, typography scale, decorative patterns
    not-found.tsx         Custom 404
    (public)/             Public pages sharing Navbar + Footer
      page.tsx            Home
      about/  contact/  login/  register/  forgot-password/
      courses/            Catalogue and courses/[slug] detail pages
    (account)/            Signed-in pages (server-verified): dashboard/ (student), teacher/
    api/auth/session/     Create (POST) / destroy (DELETE) the session cookie
    api/admin/users/      Teacher-only JSON API
  proxy.ts                Optimistic redirect to /login when no session cookie
  components/
    ui/                   Primitives (shadcn-based + Container, Section, Modal, LoadingState…)
    course/               CourseCard, CourseBadge, CoursePrice, CourseRating, catalogue…
    layout/               Navbar, Footer, Logo, navigation
    home/  shared/  forms/  auth/  decor/
  config/site.ts          Site name, contact details, navigation
  data/                   Placeholder course catalogue and marketing copy
  lib/                    Data access (courses.ts), formatting, utilities
    auth/                 Sessions, roles, CSRF guard, profiles, client flows
    firebase/             Client SDK (browser) and Admin SDK (server-only)
  types/                  Shared TypeScript types
scripts/set-role.mjs      Trusted CLI to grant/remove the teacher role
scripts/migrate-courses.mjs  One-off import of the former catalogue (input: scripts/legacy-catalogue.json)
firestore.rules           Firestore security rules (deny by default)
docs/firebase-setup.md    Firebase/Cloudinary setup, teacher bootstrap, manual test checklist
```

All course content lives in Firestore and is managed in the teacher dashboard
(`/teacher`); there is no hardcoded catalogue. Public pages read published
courses through `src/lib/catalog/server.ts` (cached, refreshed whenever a
teacher saves a change). Signed-in LMS pages read through the server-only
modules in `src/lib/lms/server/`, which authorise every request.

## Current implementation status

**Done**

- Public site: Home, About, Courses (with category filter), Course detail
  (statically generated), Contact, 404.
- Design system: brand colour tokens, serif/sans typography scale, kolam and
  mandala decorative elements, reusable UI and course components.
- Responsive layout with mobile navigation.
- Authentication: email/password registration and login, Google sign-in,
  password reset, logout; HttpOnly session cookies verified on the server.
- Roles (`student`, `teacher`) via Firebase custom claims; public registration
  always creates students; teacher granted only by `npm run set-role`.
- Protected routes: `/dashboard` (students) and `/teacher` (teachers),
  enforced server-side; `/admin` redirects to `/teacher`.
- Firestore data model: courses, modules, lessons (with bilingual resources),
  enrollments, lessonProgress. Restrictive security rules (no client writes).
- Teacher dashboard: create/edit courses in English and Malayalam, thumbnails,
  modules and lessons with reordering, draft/publish, lesson resources per
  language, manual enrollment and revocation.
- Cloudinary signed uploads (video, audio, PDF, image) verified on the server;
  YouTube/Vimeo links.
- Student dashboard: enrolled courses with progress, continue learning, lesson
  player with English / മലയാളം switch, completion tracking.
- About and Founder Notes sections (supplied English and Malayalam text) with a
  shared language switch and Noto Sans Malayalam.

**Placeholders**

- Founder photograph (placeholder until `siteConfig.founder.photo` is set).
- YouTube link (hidden until `NEXT_PUBLIC_YOUTUBE_URL` is set).
- Contact form shows a "coming soon" notice; nothing is submitted.
- "Enroll Now" opens an informational dialog; no checkout yet.
- Phone, WhatsApp, address, statistics and testimonials are sample content in
  `src/data/content.ts` and `src/config/site.ts` and must be replaced before launch.

**Planned**

1. Razorpay payments and self-service enrollment

## Learn more

- [Next.js documentation](https://nextjs.org/docs)
- [Deploying Next.js on Vercel](https://nextjs.org/docs/app/building-your-application/deploying)
