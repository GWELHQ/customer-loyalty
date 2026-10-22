import { Body, Controller, Get, Patch, Post, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Permission } from '@loyalty/shared';
import { AuditService } from '../common/audit/audit.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { StaffOnly } from '../common/decorators/staff_only.decorator';
import type { StaffPrincipal } from '../common/types/principal';
import { CashbackTrendService, type TrendFile } from './cashback-trend.service';
import { SendCashbackTrendDto, UpdateCashbackTrendSettingsDto } from './dto/send-cashback-trend.dto';

/** Org-wide report across every station, so it's REPORTS_VIEW_ALL only - a station-scoped role never sees it. */
@ApiTags('reports')
@ApiBearerAuth()
@StaffOnly()
@Controller('reports/cashback-trend')
export class CashbackTrendController {
  constructor(
    private readonly trend: CashbackTrendService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermissions(Permission.REPORTS_VIEW_ALL)
  report() {
    return this.trend.buildReport();
  }

  @Get('chart.png')
  @RequirePermissions(Permission.REPORTS_VIEW_ALL)
  async chart(@Res() res: Response) {
    const { chart } = await this.trend.exportFiles(await this.trend.buildReport());
    if (!chart) {
      res.status(404).json({ message: 'No chart available yet' });
      return;
    }
    this.sendFile(res, { filename: 'cashback-trend-chart.png', contentType: 'image/png', bytes: chart }, 'inline');
  }

  @Get('export/xlsx')
  @RequirePermissions(Permission.REPORTS_VIEW_ALL)
  async exportXlsx(@Res() res: Response) {
    const { xlsx } = await this.trend.exportFiles(await this.trend.buildReport());
    this.sendFile(res, xlsx);
  }

  @Get('export/pdf')
  @RequirePermissions(Permission.REPORTS_VIEW_ALL)
  async exportPdf(@Res() res: Response) {
    const { pdf } = await this.trend.exportFiles(await this.trend.buildReport());
    if (!pdf) {
      res.status(500).json({ message: 'Could not generate the PDF' });
      return;
    }
    this.sendFile(res, pdf);
  }

  @Post('email')
  @RequirePermissions(Permission.REPORTS_VIEW_ALL)
  async email(@Body() dto: SendCashbackTrendDto, @CurrentUser() actor: StaffPrincipal) {
    const result = await this.trend.sendReport(dto.recipients, {
      cc: dto.cc,
      subject: dto.subject,
      body: dto.body,
      replyTo: actor.email,
    });
    await this.audit.record({
      actor,
      action: 'report.email_sent',
      entityType: 'cashbackTrendReport',
      entityId: 'cashback-trend',
      entityLabel: `Cashback trend report emailed to ${dto.recipients.join(', ')}`,
      metadata: { recipients: dto.recipients, cc: dto.cc, success: result.success },
    });
    return result;
  }

  @Get('settings')
  @RequirePermissions(Permission.REPORTS_VIEW_ALL)
  settings() {
    return this.trend.getSettings();
  }

  @Patch('settings')
  @RequirePermissions(Permission.DISBURSEMENT_SETTINGS_MANAGE)
  async updateSettings(@Body() dto: UpdateCashbackTrendSettingsDto, @CurrentUser() actor: StaffPrincipal) {
    const settings = await this.trend.updateSettings(dto.autoRecipients);
    await this.audit.record({
      actor,
      action: 'cashback_trend_settings.update',
      entityType: 'cashbackTrendSettings',
      entityId: settings.id,
      metadata: { autoRecipients: settings.autoRecipients },
    });
    return settings;
  }

  private sendFile(res: Response, file: TrendFile, disposition: 'attachment' | 'inline' = 'attachment') {
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Disposition', `${disposition}; filename="${file.filename}"`);
    res.send(file.bytes);
  }
}
