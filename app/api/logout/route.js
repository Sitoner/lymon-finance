import { NextResponse } from 'next/server';
import { COOKIE, opcionesCookie } from '../../../server/sesion.js';

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE, '', opcionesCookie(0));
  return res;
}
