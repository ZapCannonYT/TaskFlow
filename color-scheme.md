# Taskflow color scheme

This is the color reference for Taskflow. Use these exact tokens in CSS, Tailwind config, or shadcn/ui theme variables. Do not introduce new colors without updating this file.

## Principles

- **Calm base.** Warm-grey neutrals carry most of the screen. Color appears only where it carries meaning.
- **One primary action color.** Blue is the only color used for the main action (Add, Done on the Today card).
- **Each status has one color.** Missed is red, due today is orange, done is green, and important is yellow. Violet marks labels.
- **Orange is the complement of blue.** Due-today tasks use orange so they stand out against the blue accent.
- **No default framework palettes.** These colors are deliberately deeper and less saturated than Tailwind defaults. Do not swap in `blue-500`, `indigo-500`, or similar.
- **Every text pairing meets WCAG AA (4.5:1).** Most meet AAA (7:1). Check any new pairing before using it.

## Tokens

### Light mode

```css
:root {
  --bg:           #ECEBE6;  /* page background */
  --surface:      #FFFFFF;  /* cards, rows, phone panels */
  --text:         #0F0E13;  /* primary text */
  --muted:        #4B4753;  /* secondary text, placeholders, metadata */
  --border:       #C9C5D0;  /* dividers, outlines, chip borders */
  --accent:       #1F3F73;  /* primary action, focus ring, checkbox on accent */
  --accent-soft:  #D8E2F2;  /* Today "one thing" card background */
  --on-accent:    #FFFFFF;  /* text on accent */
  --violet:       #55378A;  /* labels */
  --violet-soft:  #E4DCF3;  /* label tag background */
  --missed:       #A8322A;  /* missed tasks */
  --due:          #9A4A0A;  /* due-today text and icons */
  --due-soft:     #FBE3CC;  /* due-today tag background */
  --star:         #B89A00;  /* important star */
  --done:         #1E6B3A;  /* completed tasks, completed checkbox */
}
```

### Dark mode

```css
[data-theme="dark"] {
  --bg:           #0C0B10;
  --surface:      #16151C;
  --text:         #F1EFF7;
  --muted:        #B2ADBF;
  --border:       #3A3646;
  --accent:       #9CB9EE;
  --accent-soft:  #1E2C4A;
  --on-accent:    #0C0B10;
  --violet:       #C4B0F2;
  --violet-soft:  #2E2448;
  --missed:       #F08C7E;
  --due:          #F7A25B;
  --due-soft:     #4A2A10;
  --star:         #F2D65A;
  --done:         #7FD39A;
}
```

Switch themes with `data-theme` on `<html>`. Follow `prefers-color-scheme` by default, with a manual override in Settings.

## Semantic roles

| Role             | Light token                   | Dark token                    | Used for                                   |
| ---------------- | ----------------------------- | ----------------------------- | ------------------------------------------ |
| Primary action   | `--accent`                    | `--accent`                    | Add, Done on the Today card, focus ring    |
| Secondary action | `--accent` (outline)          | `--accent` (outline)          | Later button                               |
| Label            | `--violet` on `--violet-soft` | `--violet` on `--violet-soft` | Label chip and task label tag              |
| Missed           | `--missed`                    | `--missed`                    | "Missed" sublabel on overdue tasks         |
| Due today        | `--due` on `--due-soft`       | `--due` on `--due-soft`       | "Due today" tag, due dates within 24 hours |
| Important        | `--star`                      | `--star`                      | Star icon on important tasks               |
| Done             | `--done`                      | `--done`                      | Completed checkbox, completed task text    |
| Surface          | `--surface` on `--bg`         | `--surface` on `--bg`         | Cards and rows                             |

Do not use red or orange for decoration or emphasis that is not a status. Do not use green for anything except completion or success. Do not use blue for status. Blue means "you can act here."

## Contrast

| Pairing                      | Light    | Dark     |
| ---------------------------- | -------- | -------- |
| Primary text on surface      | 19.2 : 1 | 15.9 : 1 |
| Muted text on surface        | 9.0 : 1  | 8.3 : 1  |
| Done green on surface        | 6.5 : 1  | 10.1 : 1 |
| Button label on accent       | 10.4 : 1 | 9.7 : 1  |
| Violet label on violet soft  | 6.9 : 1  | 7.4 : 1  |
| Missed red on surface        | 6.7 : 1  | 7.6 : 1  |
| Due today orange on due soft | 5.1 : 1  | 6.3 : 1  |

Ratios are approximate. Recheck with a contrast tool after any change.

## Usage rules

- Never put text directly on a colored fill except the pairings in the table above.
- Never use `opacity` on text to fake a lighter color. Use `--muted` instead.
- Keep at most one accent-filled button per view.
- Icons that carry meaning (star, warning) need a text label too. Color alone must not carry the status.
- Completed tasks use the `--done` text color with a strikethrough. The strikethrough, not the color, marks them as complete.

## Changing the scheme

Edit the hex values in the token blocks above, then update the contrast table. Do not change a token name without updating every component that uses it.
