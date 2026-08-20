import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Permission } from '@loyalty/shared';
import { AuditService } from '../common/audit/audit.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { StaffOnly } from '../common/decorators/staff_only.decorator';
import type { StaffPrincipal } from '../common/types/principal';
import { CustomerImportsService } from './customer-imports.service';
import { CustomersService } from './customers.service';
import { ConfirmImportDto, normalizeDuplicateDecisions } from './dto/confirm-import.dto';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { ListCustomersQueryDto } from './dto/list-customers-query.dto';
import { RemapImportDto } from './dto/remap-import.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

@ApiTags('customers')
@ApiBearerAuth()
@StaffOnly()
@Controller('customers')
export class CustomersController {
  constructor(
    private readonly customers: CustomersService,
    private readonly imports: CustomerImportsService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermissions(Permission.CUSTOMERS_VIEW)
  list(@Query() query: ListCustomersQueryDto) {
    const { name, stationId, ...pagination } = query;
    return this.customers.list(pagination, { name, stationId });
  }

  @Get('search')
  @RequirePermissions(Permission.CUSTOMERS_VIEW)
  search(@Query('phone') phone: string) {
    if (!phone) throw new NotFoundException('phone query parameter is required');
    return this.customers.searchByPhone(phone);
  }

  @Get('imports/:id')
  @RequirePermissions(Permission.IMPORTS_VIEW)
  getImportJob(@Param('id') id: string) {
    return this.imports.findJob(id);
  }

  @Get('imports/:id/results')
  @RequirePermissions(Permission.IMPORTS_VIEW)
  getImportResults(@Param('id') id: string) {
    return this.imports.listRows(id);
  }

  @Post('imports')
  @RequirePermissions(Permission.CUSTOMERS_IMPORT)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file'))
  async createImport(
    @UploadedFile() file: Express.Multer.File,
    @Body('homeStationId') homeStationId: string,
    @CurrentUser() actor: StaffPrincipal,
  ) {
    if (!homeStationId) throw new BadRequestException('homeStationId is required');
    const job = await this.imports.uploadAndPreview(file, homeStationId, actor);
    await this.audit.record({
      actor,
      action: 'customer_import.upload',
      entityType: 'importJob',
      entityId: job.id,
      entityLabel: job.fileName,
      metadata: { fileName: job.fileName, totalRows: job.totalRows, homeStationId: job.homeStationId },
    });
    return job;
  }

  @Post('imports/:id/remap')
  @RequirePermissions(Permission.CUSTOMERS_IMPORT)
  async remapImport(
    @Param('id') id: string,
    @Body() dto: RemapImportDto,
    @CurrentUser() actor: StaffPrincipal,
  ) {
    const job = await this.imports.remapColumns(id, dto.columnMapping);
    await this.audit.record({
      actor,
      action: 'customer_import.remap',
      entityType: 'importJob',
      entityId: job.id,
      entityLabel: job.fileName,
      metadata: { columnMapping: job.columnMapping },
    });
    return job;
  }

  @Post('imports/:id/confirm')
  @RequirePermissions(Permission.CUSTOMERS_IMPORT)
  async confirmImport(
    @Param('id') id: string,
    @Body() dto: ConfirmImportDto,
    @CurrentUser() actor: StaffPrincipal,
  ) {
    const job = await this.imports.confirm(id, normalizeDuplicateDecisions(dto.duplicateDecisions), actor);
    await this.audit.record({
      actor,
      action: 'customer_import.confirm',
      entityType: 'importJob',
      entityId: job.id,
      entityLabel: job.fileName,
      metadata: { createdCount: job.createdCount, duplicateCount: job.duplicateCount, rejectedCount: job.rejectedCount },
    });
    return job;
  }

  @Get(':id')
  @RequirePermissions(Permission.CUSTOMERS_VIEW)
  findOne(@Param('id') id: string) {
    return this.customers.findById(id);
  }

  @Post()
  @RequirePermissions(Permission.CUSTOMERS_MANAGE)
  async create(@Body() dto: CreateCustomerDto, @CurrentUser() actor: StaffPrincipal) {
    const customer = await this.customers.create(dto);
    await this.audit.record({
      actor,
      action: 'customer.create',
      entityType: 'customer',
      entityId: customer.id,
      entityLabel: customer.fullName,
    });
    return customer;
  }

  @Patch(':id')
  @RequirePermissions(Permission.CUSTOMERS_MANAGE)
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateCustomerDto,
    @CurrentUser() actor: StaffPrincipal,
  ) {
    const customer = await this.customers.update(id, dto);
    await this.audit.record({
      actor,
      action: 'customer.update',
      entityType: 'customer',
      entityId: id,
      entityLabel: customer.fullName,
    });
    return customer;
  }

  @Delete(':id')
  @RequirePermissions(Permission.CUSTOMERS_DELETE)
  async remove(@Param('id') id: string, @CurrentUser() actor: StaffPrincipal) {
    const customer = await this.customers.delete(id);
    await this.audit.record({
      actor,
      action: 'customer.delete',
      entityType: 'customer',
      entityId: id,
      entityLabel: customer.fullName,
      metadata: { phoneNumber: customer.phoneNumber, totalCashbackEarned: customer.totalCashbackEarned },
    });
    return { success: true };
  }
}
