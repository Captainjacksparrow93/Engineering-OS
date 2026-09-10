'use server';

import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { prisma } from '@/core/db/prisma';
import { verifyPassword } from '@/core/auth/password';
import { createSession, destroySession } from '@/core/auth/session';
import { audit } from '@/core/audit/audit';

export interface AuthFormState {
  error?: string;
}

export async function signIn(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const password = String(formData.get('password') ?? '');

  if (!email || !password) return { error: 'Enter your email and password.' };

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, passwordHash: true, status: true },
  });

  // Same message for "no such user" and "wrong password" - an attacker should not be
  // able to enumerate who works here.
  const invalid = { error: 'Those credentials do not match an active account.' };
  if (!user) return invalid;
  if (!(await verifyPassword(password, user.passwordHash))) return invalid;
  if (user.status !== 'ACTIVE') return { error: 'This account is not active. Contact your administrator.' };

  const headerList = await headers();
  await createSession(user.id, {
    userAgent: headerList.get('user-agent') ?? undefined,
    ip: headerList.get('x-forwarded-for')?.split(',')[0]?.trim(),
  });
  await audit({ actorId: user.id, module: 'core', action: 'auth.signed_in', entityType: 'User', entityId: user.id });

  redirect('/dashboard');
}

export async function signOut(): Promise<void> {
  await destroySession();
  redirect('/login');
}
