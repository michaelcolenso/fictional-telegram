export function layout(title: string, description: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escHtml(title)}</title>
  <meta name="description" content="${escHtml(description)}">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, sans-serif; color: #1a1a1a; background: #fff; line-height: 1.6; }
    .container { max-width: 860px; margin: 0 auto; padding: 0 1.25rem; }
    header { border-bottom: 1px solid #e5e7eb; padding: 1rem 0; }
    header a { text-decoration: none; color: #1a1a1a; font-weight: 700; font-size: 1.1rem; }
    .badge-no-commission { background: #ecfdf5; color: #065f46; font-size: 0.75rem; padding: 0.2rem 0.6rem; border-radius: 999px; font-weight: 600; margin-left: 0.75rem; }
    footer { border-top: 1px solid #e5e7eb; margin-top: 3rem; padding: 1.5rem 0; font-size: 0.875rem; color: #6b7280; }
    .grade-A { color: #16a34a; font-weight: 700; }
    .grade-B { color: #2563eb; font-weight: 700; }
    .grade-C { color: #d97706; font-weight: 700; }
    .grade-D { color: #ea580c; font-weight: 700; }
    .grade-F { color: #dc2626; font-weight: 700; }
    .cta-box { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 1.5rem; margin: 1.5rem 0; }
    .btn { display: inline-block; background: #2563eb; color: #fff; padding: 0.6rem 1.25rem; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 0.95rem; }
    .btn:hover { background: #1d4ed8; }
  </style>
</head>
<body>
  <header>
    <div class="container">
      <a href="/">NursingHomeGrade</a>
      <span class="badge-no-commission">No commissions</span>
    </div>
  </header>
  <main class="container" style="padding-top:2rem; padding-bottom:2rem;">
    ${body}
  </main>
  <footer>
    <div class="container">
      Data sourced from CMS Nursing Home Compare. Updated monthly. We do not accept commissions from facilities or referral networks. <a href="/about">About</a>
    </div>
  </footer>
</body>
</html>`;
}

export function escHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
