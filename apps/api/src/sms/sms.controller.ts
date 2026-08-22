import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Permission } from '@loyalty/shared';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { StaffOnly } from '../common/decorators/staff_only.decorator';
import { SmsService } from './sms.service';

/** Read-only log of every SMS sent (or attempted) to a customer — the SMS tab on the Logs page. Same audience as the audit log. */
@ApiTags('sms')
@ApiBearerAuth()
@StaffOnly()
@RequirePermissions(Permission.AUDIT_VIEW)
@Controller('sms-deliveries')
export class SmsController {
  constructor(private readonly sms: SmsService) {}

  @Get()
  list(@Query('cursor') cursor?: string) {
    return this.sms.list(cursor);
  }
}
