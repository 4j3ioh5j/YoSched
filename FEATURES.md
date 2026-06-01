# YoSched Feature List

## Schedule Grid
- Calendar view: providers in rows, dates in columns
- Color-coded shift assignments with shift code badges
- Click-to-assign and drag-to-swap interactions
- Multi-cell selection: Shift+click or Shift+drag for rectangular range, Ctrl/Cmd+click to toggle individual cells
- Quick-key hotkeys: press a single letter to assign the mapped shift to active/selected cells
- Right-click or Tab opens shift picker preserving selection for bulk assign/clear
- Delete/Backspace clears all selected cells
- Arrow key navigation between cells
- Lock assignments to prevent auto-scheduler overwrite
- Month picker dropdown: click month/year label for quick navigation with year arrows
- Pay period summary rows: togglable via "PP Totals" button, shows +/- hours vs target (preference persisted in localStorage)
- Pay period boundaries and holiday highlighting
- Staffing requirement indicators per day
- Shift follow-rule violation warnings
- Count columns: configurable aggregations of shift codes
- Fairness deviation display per provider

## Auto-Scheduler
- Multi-step constraint-solving algorithm
- Step 1: Standing commitments (recurring shifts)
- Step 2: Fill staffing requirements with even distribution + equity tiebreak
- Step 3: Fill FTE hours targets
- Step 4: Fill remaining cells with day-off shifts
- Fairness optimization: fewest-in-run, longest-gap-since-last, fewest-historical
- Desirability weighting per shift per day-of-week
- Weekend pattern preferences (3-day, 4-day weekends)
- Sequential off-day optimization
- Per-provider shift min/max count targets per window (week, pay period, month, custom days)
- Shift follow rules: restrict which shifts can follow which
- Recovery day auto-assignment (day off after specific shifts)
- Weekend-paired shift distribution (sat+sun as a unit)
- Grouped distribution with gap maximization (bestSpread algorithm)
- Standing commitments: recurring provider-shift-day assignments
- Provider day preferences (preferred shift on specific days)
- Provider shift hour overrides
- Historical assignment context for fairness baseline
- Confidence scores and step attribution on every suggestion
- Warnings: understaffing, FTE shortfall, max-count caps, follow-rule violations

## Staff Management
- Provider profiles: name, initials, employment type, FTE percentage
- Active/inactive status and auto-schedule inclusion toggle
- Special qualifications (array field)
- Availability rules per day-of-week with patterns (every, PP week 1/2, every-N with offset)
- Conditional availability (based on another provider's assignment)
- Rule strength: hard rule vs. soft preference
- Shift eligibility rules per shift per day-of-week
- Shift min/max targets per window
- Employment types with defaults: FTE, auto-schedule, eligible shifts, availability
- Drag-to-reorder providers

## Settings
- **Shift types:** code, name, hours, color, category (work/leave/imported/other), paid/unpaid, counts toward FTE, counts on weekends, off-shift, fill-shift, weekend-paired, max per day, no-consecutive-group, scheduling priority, auto-schedulable, quick-key hotkey, drag-to-reorder
- **Shift follow rules:** restrict what shifts can follow a given shift (allow/block mode, off-shift toggle, per-shift checkboxes)
- **Date format:** app-wide setting with 9 format options (default: "MMMM D, YYYY"), applied to grid headers, tooltips, pay periods, holidays, login logs
- **Pay periods:** 14-day biweekly with target hours, batch creation
- **Holidays:** manual entry or auto-populate US federal holidays by year
- **Desirability weights:** per shift per day-of-week (-5 to +5) with reason field
- **Staffing requirements:** minimum staff count per shift code per day-of-week (including holidays)
- **Scheduling preferences:** 3-day/4-day weekend weights, sequential off-day weight, equity thresholds (low/med/high)
- **Employment types:** default FTE, auto-schedule, eligible shifts, availability rules
- **Equity factors:** weighted factors (desirability, holiday work, per-shift), enable/disable, reorderable
- **Count columns:** custom columns aggregating counts of specific shift codes on the grid
- **FTE targets:** FTE percentage to target hours mapping

## Statistics / Equity Analytics
- Department-wide averages per tracked shift type (FTE-normalized)
- Per-provider metrics: desirability score, opportunity-adjusted score, holiday count, shift tallies, hours, work days, leave days
- Sortable table with deviation highlighting (color-coded by equity thresholds)
- Bar chart: shift distribution across all providers (toggleable per shift type)
- Radar chart: provider profile vs. department average (z-score or actual counts, FTE-normalized or raw, opportunity-adjusted toggle)
- Min FTE filter
- Tallies toggle for raw shift counts

## Authentication & Security
- Email + password login with bcrypt (cost 12)
- TOTP two-factor authentication (RFC 6238 via otplib)
- QR code generation for authenticator app setup
- TOTP secret encryption at rest (AES-256)
- Device trust: skip TOTP on remembered devices (HMAC-signed, configurable duration)
- Account lockout: 5 failed attempts triggers 15-minute lock
- Rate limiting per email
- Login logging: success/failure, reason, IP, user agent, timestamp
- JWT sessions via NextAuth (8-hour max age)
- Role-based access: admin (full), manager (staff + schedule), viewer (read-only)

## User Management
- Create, edit, deactivate user accounts
- Role assignment (admin, manager, viewer)
- Password management with validation
- TOTP reset (admin function)
- Login log viewer with sorting/filtering

## Assignment Management
- Create, update, delete individual assignments
- Swap assignments between providers/dates
- Lock/unlock assignments
- Source tracking: manual, auto, imported
- Notes per assignment
- Bulk import endpoint

## Account Settings
- Password change (requires current password)
- TOTP setup/disable
- Profile viewing
