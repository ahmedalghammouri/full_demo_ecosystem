import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { timingSafeEqual } from 'node:crypto';

import { CONFIG_USERS } from './config-users';

/**
 * Dashboard auth restricted to the two static {@link CONFIG_USERS}. Does NOT
 * touch the platform DB, so the edge admin can always log in (offline-safe).
 */
@Injectable()
export class AuthService {
  constructor(private readonly jwt: JwtService) {}

  async login(email: string, password: string) {
    const user = CONFIG_USERS.find((u) => u.email.toLowerCase() === email.toLowerCase());
    if (!user || !safeEqual(password, user.password)) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const payload = { sub: user.email, email: user.email, role: user.role, name: user.name };
    const accessToken = await this.jwt.signAsync(payload, { expiresIn: '8h' });
    return { accessToken, user: { email: user.email, name: user.name, role: user.role } };
  }
}

/** Constant-time string comparison (avoids leaking length/content via timing). */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) {
    // Compare against self to keep timing roughly constant, then fail.
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}
