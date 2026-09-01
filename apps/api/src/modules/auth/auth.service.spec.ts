import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { PrismaService } from '../../database/prisma.service';
import { KpiService } from '../production/kpi.service';
import * as bcrypt from 'bcryptjs';

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    update: jest.fn(),
    findFirst: jest.fn(),
  },
  userSession: {
    create: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
};

const mockUsersService = {
  findByEmail: jest.fn(),
  findById: jest.fn(),
};

const mockJwtService = {
  signAsync: jest.fn(),
  verifyAsync: jest.fn(),
};

const mockConfigService = {
  get: jest.fn((key: string, defaultVal?: unknown) => {
    const config: Record<string, unknown> = {
      'jwt.secret': 'test-secret-min-32-characters-long!',
      'jwt.refreshSecret': 'test-refresh-min-32-characters-long!',
      'jwt.expiresIn': '15m',
      'jwt.refreshExpiresIn': '7d',
    };
    return config[key] ?? defaultVal;
  }),
};

const mockEventEmitter = { emit: jest.fn() };

/**
 * The landing overview reports OEE, so AuthService now depends on the one
 * engine that computes it. `factorsFromFacts` returns nulls for an absent
 * measurement -- mirrored here, because the whole point of the change is that
 * "no data" must never arrive at a screen as 0%.
 */
const mockKpiService = {
  machineFactTotals: jest.fn().mockResolvedValue(new Map()),
  factorsFromFacts: jest.fn().mockReturnValue({
    availability: null, performance: null, quality: null,
    oee: null, availabilityTb: null, oeeTb: null,
  }),
};

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: UsersService, useValue: mockUsersService },
        { provide: JwtService, useValue: mockJwtService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: EventEmitter2, useValue: mockEventEmitter },
        { provide: KpiService, useValue: mockKpiService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('validateUser', () => {
    it('should return null when user not found', async () => {
      mockUsersService.findByEmail.mockResolvedValue(null);
      const result = await service.validateUser('test@example.com', 'password');
      expect(result).toBeNull();
    });

    it('should return null when user is inactive', async () => {
      mockUsersService.findByEmail.mockResolvedValue({
        id: '1',
        email: 'test@example.com',
        password: await bcrypt.hash('password', 10),
        isActive: false,
        failedLoginAttempts: 0,
      });
      const result = await service.validateUser('test@example.com', 'password');
      expect(result).toBeNull();
    });

    it('should return user when credentials are valid', async () => {
      const hashedPassword = await bcrypt.hash('correctpassword', 10);
      // validateUser loads the user via prisma.user.findFirst and compares passwordHash.
      mockPrisma.user.findFirst.mockResolvedValue({
        id: '1',
        email: 'test@example.com',
        passwordHash: hashedPassword,
        isActive: true,
        lockedAt: null,
        failedLoginAttempts: 0,
        role: 'OPERATOR',
        factoryId: 'tenant-1',
      });
      mockPrisma.user.update.mockResolvedValue({});

      const result = await service.validateUser('test@example.com', 'correctpassword');
      expect(result).not.toBeNull();
      expect(result?.email).toBe('test@example.com');
    });
  });
});
