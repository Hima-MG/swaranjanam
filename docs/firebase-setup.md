# Firebase, Cloudinary & LMS setup

How authentication and the learning platform work in Swaraanjanam, what to
configure in Firebase and Cloudinary, and how to create the first teacher safely.

## How it works

1. The browser signs in with the Firebase client SDK (email/password or
   Google). Client persistence is in-memory only.
2. The browser sends the fresh ID token to `POST /api/auth/session`.
3. The server (Admin SDK) verifies the token, requires the sign-in to be less
   than 5 minutes old, creates the `users/{uid}` profile on first sign-in
   (**always role `student`**), and sets an **HttpOnly** session cookie
   (`__session`; `Secure` in production, `SameSite=Lax`, 5 days by default).
4. The client SDK signs out again — the cookie is the only credential.
5. Protected pages (`/dashboard`, `/teacher`) and every Server Action verify
   the cookie on the server, including revocation and disabled-account checks.
   `src/proxy.ts` only does a fast "is there a cookie?" redirect.
6. Logout (`DELETE /api/auth/session`) clears the cookie and revokes the
   user's refresh tokens, invalidating all of their sessions.

**Roles.** There are exactly two: `student` and `teacher`. The role lives in a
Firebase **custom claim** (`role: "teacher"`; the older `"admin"` value is still
honoured as teacher). Anyone without it is a student. Custom claims can only be
set with Admin credentials, so users cannot change their own role. The `role`
field on `users/{uid}` mirrors the claim for display. `/admin` redirects to `/teacher`.

**Course access.** A teacher can manage a course only if their uid is in the
course's `teacherIds`. A student can open a course only with an `active`
enrollment in a **published** course. These checks run in
`src/lib/lms/server/access.ts` for every page and Server Action — the Admin SDK
bypasses Firestore rules, so this code is the security boundary.

**CSRF.** The session endpoints reject requests unless the `Origin` matches the
site (and `Sec-Fetch-Site` is `same-origin` when sent) and the body is JSON.
Server Actions get Next.js's built-in Origin check. Combined with `SameSite=Lax`
cookies, cross-site requests cannot create sessions or mutate data.

## Data model

| Collection | Document id | Notes |
| --- | --- | --- |
| `users` | uid | profile; `role` mirrors the claim |
| `courses` | slug (migrated) or auto id | `title`/`titleMl`, `description`/`descriptionMl`, `thumbnailUrl`, `status` (`draft`/`published`), `teacherIds` |
| `modules` | auto id | `courseId`, bilingual text, `order` |
| `lessons` | auto id | `courseId`, `moduleId`, bilingual text, `order`, `resources[]` |
| `enrollments` | `{courseId}_{studentId}` | `status` (`active`/`revoked`), `enrolledAt`, `enrolledBy` |
| `lessonProgress` | `{studentId}_{lessonId}` | `completed`, `completedAt`, `lastAccessedAt` |

Each lesson resource stores `id`, `title`, `type` (video/audio/pdf/image),
`language` (`en`/`ml`), `source` (cloudinary/external), `url`, `publicId`,
`fileName`, `format`, `bytes`, `downloadable` and `order`. Queries filter by
equality only and sort in memory, so no composite indexes are needed.

## 1. Firebase console configuration

1. **Authentication → Sign-in method**
   - Enable **Email/Password**.
   - Enable **Google** and set a project support email.
2. **Authentication → Settings → Authorized domains** — add every domain the
   site is served from: `localhost` (present by default), your
   `*.vercel.app` production domain, and any custom domain. Google sign-in
   fails with `auth/unauthorized-domain` otherwise.
3. **Authentication → Settings → User actions** — keep **Email enumeration
   protection** enabled (default for new projects).
4. **Authentication → Templates → Password reset** — optionally customise the
   sender name and message.
5. **Firestore Database** — create the database (Production mode) if it does
   not exist, then publish the rules from `firestore.rules`:
   - Console: **Firestore → Rules**, paste the file contents, **Publish**; or
   - CLI: `npx firebase-tools deploy --only firestore:rules --project <project-id>`

   The rules deny everything by default and block **all** client writes.
   Reads are limited to your own profile, enrollments and progress, and to
   courses, modules and lessons you teach or are actively enrolled in.

## 2. Environment variables

Copy `.env.example` to `.env.local` and fill in:

| Variable | Where to find it |
| --- | --- |
| `NEXT_PUBLIC_FIREBASE_*` (6 values) | Project settings → General → Your apps → Web app config |
| `FIREBASE_ADMIN_PROJECT_ID`, `FIREBASE_ADMIN_CLIENT_EMAIL`, `FIREBASE_ADMIN_PRIVATE_KEY` | Project settings → Service accounts → Generate new private key (copy from the JSON, then delete the JSON) |
| `SESSION_COOKIE_MAX_AGE_DAYS` | Optional, 1–14 (default 5) |
| `NEXT_PUBLIC_SITE_URL` | Your production URL on Vercel |
| `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | Cloudinary console → Settings → API Keys |
| `CLOUDINARY_UPLOAD_FOLDER` | Optional root folder (default `swaranjanam`) |
| `NEXT_PUBLIC_YOUTUBE_URL` | Optional; the YouTube link stays hidden until set |

**Private key format.** Either keep it on one line in double quotes with
literal `\n` sequences (recommended — this is also how to paste it into
Vercel), or as a quoted multi-line value in `.env.local`. Both are accepted.

**Vercel.** Add the same variables under Project → Settings → Environment
Variables for Production (and Preview if used), then redeploy —
`NEXT_PUBLIC_*` values are baked in at build time.

Never commit real values. `.env.example` is public and must contain
placeholders only.

## 3. Bootstrapping the first teacher

There is deliberately **no web UI or API that can grant the teacher role** —
not even for existing teachers. It is granted by a trusted local script that
uses the service-account credentials:

1. Register an account on the site normally (it is created as a student).
2. On a trusted machine with `.env.local` configured, run:

   ```bash
   npm run set-role -- owner@example.com teacher
   ```

3. The script sets the `role` custom claim, mirrors it to `users/{uid}`
   (merge, no other fields touched), and revokes the user's sessions.
4. The user signs in again and lands on `/teacher`.

To remove teacher access: `npm run set-role -- owner@example.com student`.

Keep the service-account key only on machines you trust; anyone holding it has
full control of the Firebase project.

## 4. Course catalogue (Firestore is the source of truth)

Every course — title, Malayalam text, thumbnail, catalogue details (summary,
level, category, fees, outcomes …), modules, lessons, resources and
publication status — lives in Firestore and is edited in the teacher
dashboard. The public `/courses` pages show **published** courses only, read
through `src/lib/catalog/server.ts`. They are cached for up to an hour and
refreshed immediately whenever a teacher saves a change.

### One-off import of the former static catalogue

The ten courses that used to be hardcoded in `src/data/courses.ts` are kept in
`scripts/legacy-catalogue.json` purely as input for a one-off import:

```bash
npm run migrate:courses -- --dry-run
npm run migrate:courses -- --teacher=owner@example.com
```

- Course documents use the existing slug as their id, so `/courses/<slug>`
  URLs keep working. Modules and lessons get deterministic ids
  (`<slug>--m1`, `<slug>--m1--l1`).
- Courses are imported as **published** (they were public before); add
  `--status=draft` to import them hidden.
- Re-running never duplicates or overwrites anything: existing courses are
  left alone, except that catalogue fields still *missing* on imported
  courses are filled in, and `--teacher` adds that teacher to each course.
- The old sample ratings and student counts are stored under `legacy` for the
  record but are not shown on the site.
- After the import is verified, delete `scripts/legacy-catalogue.json` (and
  optionally the script). From then on, all course changes are made in the
  teacher dashboard.

## 5. Cloudinary

Uploads go **directly from the browser to Cloudinary** using a signature the
server creates only after checking that the teacher is assigned to the course.
The signature fixes the file's `public_id` inside that course's folder and the
allowed formats. Before saving anything, the server verifies Cloudinary's
response signature and re-reads the asset from the Admin API (type, size,
folder); rejected uploads are deleted. `CLOUDINARY_API_SECRET` never reaches
the browser.

| Type | Formats | Max size |
| --- | --- | --- |
| Image / thumbnail | JPG, PNG, WebP | 10 MB |
| PDF | PDF | 10 MB |
| Audio | MP3, M4A, AAC, WAV, OGG | 50 MB |
| Video | MP4, MOV, WebM | 100 MB |

Limits live in `src/lib/media/config.ts`. Videos over 100 MB need a paid
Cloudinary plan and chunked uploads, or a YouTube/Vimeo link (also supported).

**Required console setting:** new Cloudinary accounts block PDF delivery.
Enable *Settings → Security → "Allow delivery of PDF and ZIP files"*, or PDFs
will upload but fail to open.

**Access control, not DRM.** Lesson media URLs are shown only to students
with an active enrollment, but Cloudinary delivery URLs are public: anyone who
is given a URL can open it. Do not describe the content as copy-protected.

## 6. Manual test checklist

These need a real browser session and live Firebase/Cloudinary, so they are
not covered by the automated checks.

**Auth & roles**

- Register with email/password → lands on `/dashboard`; `users/{uid}` exists
  with `role: "student"`.
- Log out → navbar shows Login; `/dashboard` redirects to `/login`.
- Log in with email/password and with Google.
- Forgot password → reset email arrives; the link resets the password.
- Student visiting `/teacher` → redirected to `/dashboard`.
- After `set-role … teacher` and signing in again → lands on `/teacher`;
  visiting `/dashboard` redirects to `/teacher`.
- `GET /api/admin/users` returns 401 signed out and 403 as a student.

**Public catalogue**

- `/courses` lists only published courses; a draft never appears, and its
  `/courses/<slug>` URL returns "not found".
- Publish a course → it appears on `/courses`, on the home page (if featured or
  among the first published) and in the footer immediately.
- Edit the title, summary, fees, outcomes or thumbnail → the public page
  updates right away. Unpublish → it disappears from all public pages.
- The Malayalam switch on a course page shows the Malayalam description and
  outcomes, or "Not available in മലയാളം yet".

**Teacher**

- Create a course → opens as a draft. Edit English and Malayalam details and
  the catalogue details; change the web address while it is a draft.
- Upload, replace and remove a thumbnail.
- Add modules and lessons; reorder with the arrow buttons; delete an empty module.
- Publishing a course with no lessons shows an error; with lessons it publishes.
- In a lesson: upload a video, an audio file and a PDF in English, and at
  least one Malayalam resource; add a YouTube link; edit, reorder and delete
  resources.
- Try an empty file, a renamed `.exe`, and an oversize file → clear errors,
  nothing saved.
- Students page: enroll a registered student by email; an unknown email and a
  teacher's email are refused; revoke and restore access.
- A second teacher who is not assigned to the course gets "not found".

**Student**

- Dashboard shows enrolled, published courses with progress; drafts are hidden.
- In a lesson, the English / മലയാളം switch shows only that language's
  resources, with a clear message when a language has none.
- Video and audio play; PDFs open; Download appears only when allowed.
- Mark complete / not complete updates progress; "Continue learning" resumes
  the last opened lesson.
- After the teacher revokes access, the course and lesson URLs return 404.
- Check `/dashboard`, `/teacher` and a lesson page at phone, tablet and
  desktop widths.
