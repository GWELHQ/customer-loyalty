import { BadRequestException, Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Permission, SYSTEM_EMAIL_DEFINITIONS, SystemEmailType } from '@loyalty/shared';
import { AuditService } from '../common/audit/audit.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { StaffOnly } from '../common/decorators/staff_only.decorator';
import type { StaffPrincipal } from '../common/types/principal';
import { UpdateEmailRecipientsDto } from './dto/update-email-recipients.dto';
import { EmailRecipientsService } from './email-recipients.service';

@ApiTags('email-recipients')
@ApiBearerAuth()
@StaffOnly()
@Controller('email-recipients')
export class EmailRecipientsController {
  constructor(
    private readonly emailRecipients: EmailRecipientsService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermissions(Permission.EMAIL_RECIPIENTS_MANAGE)
  list() {
    return this.emailRecipients.list();
  }

  @Patch(':type')
  @RequirePermissions(Permission.EMAIL_RECIPIENTS_MANAGE)
  async update(@Param('type') type: string, @Body() dto: UpdateEmailRecipientsDto, @CurrentUser() actor: StaffPrincipal) {
    const definition = SYSTEM_EMAIL_DEFINITIONS.find((d) => d.type === type);
    if (!definition) throw new BadRequestException(`Unknown email type "${type}"`);
    const saved = await this.emailRecipients.update(type as SystemEmailType, dto);
    await this.audit.record({
      actor,
      action: 'email_recipients.update',
      entityType: 'emailRecipientSettings',
      entityId: type,
      entityLabel: `Extra recipients for "${definition.label}"`,
      metadata: { to: saved.to, cc: saved.cc },
    });
    return saved;
  }
}
