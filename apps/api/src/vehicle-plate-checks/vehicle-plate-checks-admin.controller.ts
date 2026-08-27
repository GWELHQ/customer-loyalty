import { Controller, Get, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Permission } from '@loyalty/shared';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { StaffOnly } from '../common/decorators/staff_only.decorator';
import { VehiclePlateChecksService } from './vehicle-plate-checks.service';

/**
 * Staff-facing read access to a vehicle-plate-check's photo, for fraud
 * review — separate from VehiclePlateChecksController, which is the
 * attendant-only creation endpoint. Gated behind FRAUD_VIEW (not just any
 * staff session) since these are photos of a customer's vehicle, not
 * routine sale data.
 */
@ApiTags('vehicle-plate-checks')
@ApiBearerAuth()
@StaffOnly()
@RequirePermissions(Permission.FRAUD_VIEW)
@Controller('vehicle-plate-checks')
export class VehiclePlateChecksAdminController {
  constructor(private readonly plateChecks: VehiclePlateChecksService) {}

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.plateChecks.findByIdWithViewUrl(id);
  }
}
