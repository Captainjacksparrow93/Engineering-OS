import { NextRequest, NextResponse } from 'next/server';
import { getPrincipal } from '@/core/auth/session';
import { hasPermissionAnywhere } from '@/core/rbac/engine';
import { buildPass, rolesFor } from '@/modules/erp/sso';
import { config } from '@/core/config';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const principal = await getPrincipal();
  if (!principal) {
    const loginUrl = new URL('/login', request.url);
    return NextResponse.redirect(loginUrl);
  }

  if (!hasPermissionAnywhere(principal, 'erp.access')) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  let erpnextPublicUrl: string | undefined;
  try {
    erpnextPublicUrl = config().ERPNEXT_PUBLIC_URL;
  } catch {
    erpnextPublicUrl = process.env.ERPNEXT_PUBLIC_URL;
  }
  erpnextPublicUrl = erpnextPublicUrl || process.env.ERPNEXT_PUBLIC_URL;

  if (!erpnextPublicUrl) {
    return new NextResponse('ERP integration is not configured', { status: 500 });
  }

  const actionUrl = `${erpnextPublicUrl.replace(/\/+$/, '')}/api/method/acs_erp.sso.login`;

  const pass = buildPass(
    {
      email: principal.email,
      name: principal.fullName,
      roles: rolesFor(principal.roleKeys),
    },
    'login',
  );

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Redirecting to ERP...</title>
</head>
<body>
  <p>Connecting to ERP...</p>
  <form id="ssoForm" method="POST" action="${actionUrl}">
    <input type="hidden" name="pass" value="${pass}" />
    <noscript>
      <button type="submit">Click here to continue to ERP</button>
    </noscript>
  </form>
  <script>
    document.getElementById('ssoForm').submit();
  </script>
</body>
</html>`;

  return new NextResponse(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'origin-when-cross-origin',
    },
  });
}
