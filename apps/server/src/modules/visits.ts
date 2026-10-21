import { Module } from '@nestjs/common';
import { SimulationModule } from '../game/simulation.module';
import { RoomsModule } from './rooms';
import { VisitSessionService } from './visit-session.service';
import { VisitsGateway } from './visits.gateway';

@Module({
  imports: [RoomsModule, SimulationModule],
  providers: [VisitSessionService, VisitsGateway],
})
export class VisitsModule {}
