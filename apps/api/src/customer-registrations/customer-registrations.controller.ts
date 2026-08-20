import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CustomerRegistrationStatus, Permission, Role } from '@loyalty/shared';
import { AuditService } from '../common/audit/audit.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { StaffOnly } from '../common/decorators/staff_only.decorator';
import type { StaffPrincipal } from '../common/types/principal';
import { CustomerRegistrationsService } from './customer-registrations.service';
import { DecideCustomerRegistrationDto } from './dto/decide-customer-registration.dto';

@ApiTags('customer-registrations')
@ApiBearerAuth()
@StaffOnly()
@Controller('customer-registrations')
export class CustomerRegistrationsController {
  constructor(
    private readonly requests: CustomerRegistrationsService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermissions(Permission.CUSTOMER_REGISTRATIONS_VIEW)
  list(@Query('status') status: CustomerRegistrationStatus | undefined, @CurrentUser() actor: StaffPrincipal) {
    // Station Supervisor is always station-scoped; RTSM/Admin see everything.
    const stationId = actor.role === Role.STATION_SUPERVISOR ? actor.assignedStationId : undefined;
    return this.requests.list({ status, stationId });
  }

  @Get(':id')
  @RequirePermissions(Permission.CUSTOMER_REGISTRATIONS_VIEW)
  findOne(@Param('id') id: string) {
    return this.requests.findById(id);
  }

  @Post(':id/approve')
  @RequirePermissions(Permission.CUSTOMER_REGISTRATIONS_APPROVE)
  async approve(
    @Param('id') id: string,
    @Body() dto: DecideCustomerRegistrationDto,
    @CurrentUser() actor: StaffPrincipal,
  ) {
    const request = await this.requests.decide(id, 'approved', dto.decisionNote, actor);
    await this.audit.record({
      actor,
      action: 'customer_registration_request.approve',
      entityType: 'customerRegistrationRequest',
      entityId: id,
      entityLabel: request.customerFullName,
      metadata: { customerId: request.customerId, saleId: request.saleId },
    });
    return request;
  }

  @Post(':id/reject')
  @RequirePermissions(Permission.CUSTOMER_REGISTRATIONS_APPROVE)
  async reject(
    @Param('id') id: string,
    @Body() dto: DecideCustomerRegistrationDto,
    @CurrentUser() actor: StaffPrincipal,
  ) {
    const request = await this.requests.decide(id, 'rejected', dto.decisionNote, actor);
    await this.audit.record({
      actor,
      action: 'customer_registration_request.reject',
      entityType: 'customerRegistrationRequest',
      entityId: id,
      entityLabel: request.customerFullName,
    });
    return request;
  }
}
