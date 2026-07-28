# Workflow Evaluation

This project now applies the supplied Admin, Instructor, Client, schedule, booking,
attendance, plan-credit, profile, calendar, and notification workflows while
preserving existing production data and payment behavior.

## Implemented

- Email/password registration and login, Google login, and optional Facebook login.
- Role-based Admin, Instructor, and Client dashboards.
- Admin-managed official class titles and defaults.
- Instructor schedule proposals with one-time, daily, weekly, and monthly recurrence.
- Pending approval, changes requested, rejected, on-hold, published, cancellation
  requested, cancelled, and completed/ended schedule behavior.
- Conflict validation before publication for rooms, instructors, and overlapping time.
- Admin approval, rejection, change request, hold, room reassignment, and publication.
- Public/client visibility restricted to future published schedules with active rooms
  and instructors.
- Admin and client booking validation for capacity, conflicts, active plan validity,
  eligible class, and remaining plan credits.
- Atomic seat claiming plus plan-credit reservation; credits are consumed only after
  the class ends with Present attendance and are returned after cancellation.
- Instructor cancellation requests and Admin-controlled final cancellation.
- Admin plan-validity extension with an audit record and client notification.
- Profile settings for all roles, including profile picture updates.
- Week, month, and list calendar views.
- Notification bell limited to the latest 10 records plus a complete notification
  history page.
- Attendance controls remain hidden until the server-validated class start time.

## Adapted to Existing System

- The UI label **Confirmed** maps to the existing stored booking status `accepted`.
- **Checked In / Present** uses the existing QR check-in and attendance fields.
- **Completed / Fully Used** is derived after the class end and successful Present
  attendance rather than being set at purchase time.
- Schedule completion remains time-derived for historical accuracy; the existing
  `completed` stored status is also supported.
- The public schedule's fixed login prompt was retained because it is a booking
  call-to-action required by the existing guest workflow, not a dashboard bottom menu.

## Policy Requiring a Business Decision

- Absent and No-Show do not currently consume a plan credit. The supplied workflow
  says the credit may be returned, retained, or voided according to a configured
  policy, but it does not define that policy. Present attendance is therefore the
  only automatic consumption event.
