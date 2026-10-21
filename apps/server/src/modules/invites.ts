import { Module } from '@nestjs/common';
import { InvitesController } from './invites.controller';
import { InvitesService } from './invites.service';
import { RoomsModule } from './rooms';

@Module({
  imports: [RoomsModule],
  controllers: [InvitesController],
  providers: [InvitesService],
})
export class InvitesModule {}
