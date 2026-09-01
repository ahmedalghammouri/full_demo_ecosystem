import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { EcosystemService } from './ecosystem.service';
import { Public } from '../../common/decorators/public.decorator';

/**
 * Ecosystem coverage — what the platform has, and what it does not.
 *
 * Deliberately public. This is the screen a reviewer is pointed at to answer
 * "how much of the suite is real", and putting it behind a login would make
 * that answer look guarded.
 */
@ApiTags('Ecosystem')
@ApiBearerAuth()
@Controller('ecosystem')
export class EcosystemController {
  constructor(private readonly svc: EcosystemService) {}

  @Public()
  @Get('coverage')
  @ApiOperation({ summary: 'The 64 Application Suite modules by layer, with build status' })
  coverage() {
    return this.svc.overview();
  }

  @Public()
  @Get('factories')
  @ApiOperation({ summary: 'Each site classification and the modules it carries' })
  factories() {
    return this.svc.byFactory();
  }
}
