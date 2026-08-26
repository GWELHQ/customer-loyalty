import { Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { StaffOnly } from '../common/decorators/staff_only.decorator';
import type { StaffPrincipal } from '../common/types/principal';
import { NotificationsService } from './notifications.service';

@ApiTags('notifications')
@ApiBearerAuth()
@StaffOnly()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@CurrentUser() user: StaffPrincipal) {
    return this.notifications.listForUser(user.userId);
  }

  @Patch(':id/read')
  markRead(@Param('id') id: string, @CurrentUser() user: StaffPrincipal) {
    return this.notifications.markRead(id, user.userId);
  }

  @Patch('read-all')
  @HttpCode(HttpStatus.OK)
  async markAllRead(@CurrentUser() user: StaffPrincipal) {
    await this.notifications.markAllRead(user.userId);
    return { success: true };
  }

  @Delete()
  @HttpCode(HttpStatus.OK)
  async clearAll(@CurrentUser() user: StaffPrincipal) {
    await this.notifications.deleteAll(user.userId);
    return { success: true };
  }
}
