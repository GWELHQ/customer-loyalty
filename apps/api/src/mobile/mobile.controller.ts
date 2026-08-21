import { Body, Controller, Get, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { NotificationType, Role } from '@loyalty/shared';
import { AttendantOnly } from '../common/decorators/attendant-only.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { nairobiDayBoundsUtc, nairobiMonthKey, nairobiToday } from '../common/time/nairobi';
import { CustomerRegistrationsService } from '../customer-registrations/customer-registrations.service';
import { CustomersService } from '../customers/customers.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PricesService } from '../prices/prices.service';
import { ReconciliationService } from '../reconciliation/reconciliation.service';
import { SalesService } from '../sales/sales.service';
import { buildSaleConfirmationMessage, SmsService } from '../sms/sms.service';
import { StationsService } from '../stations/stations.service';
import { UsersService } from '../users/users.service';
import type { AttendantPrincipal } from '../common/types/principal';
import { BulkSyncDto } from './dto/bulk-sync.dto';
import { MobileCreateSaleDto } from './dto/mobile-create-sale.dto';
import { ReportSmsStatusDto } from './dto/report-sms-status.dto';
import { SubmitCustomerRegistrationDto } from './dto/submit-customer-registration.dto';
import { SyncOperationsService } from './sync-operations.service';

/**
 * The Android-facing surface of the API. Every route here requires an
 * attendant PIN session (@AttendantOnly) and every query is scoped to the
 * calling attendant's own identity and assigned station — never trusting
 * a station/attendant ID supplied by the client.
 */
@ApiTags('mobile')
@ApiBearerAuth()
@AttendantOnly()
@Controller('mobile')
export class MobileController {
  constructor(
    private readonly stations: StationsService,
    private readonly prices: PricesService,
    private readonly customers: CustomersService,
    private readonly sales: SalesService,
    private readonly reconciliation: ReconciliationService,
    private readonly syncOps: SyncOperationsService,
    private readonly customerRegistrations: CustomerRegistrationsService,
    private readonly notifications: NotificationsService,
    private readonly users: UsersService,
    private readonly sms: SmsService,
  ) {}

  @Get('bootstrap')
  async bootstrap(@CurrentUser() attendant: AttendantPrincipal) {
    const [station, prices] = await Promise.all([
      this.stations.findById(attendant.assignedStationId),
      this.prices.getCurrent(),
    ]);
    return {
      attendant,
      station,
      prices,
      // Bumped whenever bootstrap-relevant reference data (prices, config)
      // changes shape; the Android app re-bootstraps when its cached
      // version is behind this.
      configVersion: 1,
      serverTime: new Date().toISOString(),
    };
  }

  @Get('customers/search')
  search(@Query('phone') phone: string) {
    if (!phone) throw new NotFoundException('phone query parameter is required');
    return this.customers.searchByPhone(phone);
  }

  @Get('prices/current')
  currentPrices() {
    return this.prices.getCurrent();
  }

  /**
   * `monthToDateCashback` is included so the app can compose the same SMS
   * text it would need to send itself (see POST sales/:id/sms-status) —
   * this backend does not send SMS for attendant-sourced sales.
   */
  @Post('sales')
  async createSale(@Body() dto: MobileCreateSaleDto, @CurrentUser() actor: AttendantPrincipal) {
    const sale = await this.sales.createSale(dto, actor);
    const summary = await this.sales.monthlySummary(sale.customerId, nairobiMonthKey(sale.saleDate));
    return { ...sale, monthToDateCashback: summary.totalCashback };
  }

  /**
   * Called after the app sends the sale-confirmation SMS itself directly
   * via Africa's Talking — records the outcome for the audit trail and
   * keeps `sale.smsStatus` (shown in the web app) accurate. Looks the sale
   * up server-side rather than trusting a client-supplied phone/amount.
   */
  @Post('sales/:id/sms-status')
  async reportSmsStatus(
    @Param('id') id: string,
    @Body() dto: ReportSmsStatusDto,
    @CurrentUser() actor: AttendantPrincipal,
  ) {
    const sale = await this.sales.findById(id);
    if (sale.attendantId !== actor.attendantId) {
      throw new NotFoundException('Sale not found');
    }
    const summary = await this.sales.monthlySummary(sale.customerId, nairobiMonthKey(sale.saleDate));
    const message = buildSaleConfirmationMessage({
      cashbackEarned: sale.snapshot.cashbackEarned,
      monthToDateCashback: summary.totalCashback,
    });
    return this.sms.recordExternalOutcome({
      saleId: sale.id,
      customerPhone: sale.customerPhoneAtSale,
      message,
      success: dto.success,
      providerName: 'africastalking-android',
      providerResponse: dto.providerResponse,
      errorReason: dto.errorReason,
    });
  }

  /**
   * For a phone number that isn't a customer yet — records the sale that
   * happened, but only as a pending request. Nothing lands in `customers`
   * or `sales` until a Station Supervisor/RTSM/Admin approves it.
   */
  @Post('customer-registrations')
  async submitCustomerRegistration(
    @Body() dto: SubmitCustomerRegistrationDto,
    @CurrentUser() actor: AttendantPrincipal,
  ) {
    const request = await this.customerRegistrations.submit(dto, actor);

    const approvers = (await this.users.list()).filter(
      (u) =>
        u.role === Role.ADMIN ||
        u.role === Role.RTSM ||
        (u.role === Role.STATION_SUPERVISOR && u.assignedStationId === request.stationId),
    );
    await this.notifications.notifyMany(
      approvers.map((u) => u.id),
      {
        type: NotificationType.CUSTOMER_REGISTRATION_REQUEST,
        title: 'New customer registration request',
        body: `${actor.fullName} registered a new customer at ${request.stationNameAtRequest}.`,
        linkPath: `/customer-registrations/${request.id}`,
      },
    );

    return request;
  }

  @Post('sync')
  async sync(@Body() dto: BulkSyncDto, @CurrentUser() actor: AttendantPrincipal) {
    const results = [];
    for (const sale of dto.sales) {
      const outcome = await this.sales.syncOne(sale, actor);
      await this.syncOps.record(actor.attendantId, outcome);
      results.push(outcome);
    }
    return { results };
  }

  @Get('sync-status')
  syncStatus(@CurrentUser() actor: AttendantPrincipal) {
    return this.syncOps.recentForAttendant(actor.attendantId);
  }

  @Get('daily-summary')
  async dailySummary(@CurrentUser() actor: AttendantPrincipal, @Query('date') date?: string) {
    const targetDate = date ?? nairobiToday();
    const reconciliation = await this.reconciliation.listDaily({
      stationId: actor.assignedStationId,
      date: targetDate,
    });
    return { date: targetDate, reconciliation };
  }

  @Get('sales/mine')
  mySales(@CurrentUser() actor: AttendantPrincipal, @Query('date') date?: string) {
    const targetDate = date ?? nairobiToday();
    const { startUtc, endUtc } = nairobiDayBoundsUtc(targetDate);
    // `to` is inclusive in SalesService.list — back off 1ms so the next
    // Nairobi day's opening instant isn't double-counted.
    const inclusiveEnd = new Date(new Date(endUtc).getTime() - 1).toISOString();
    return this.sales.list(
      { page: 1, pageSize: 200 },
      { attendantId: actor.attendantId, from: startUtc, to: inclusiveEnd },
    );
  }
}
