import { Module } from '@nestjs/common';
import { SimulationEngine } from './simulation';

@Module({ providers: [SimulationEngine], exports: [SimulationEngine] })
export class SimulationModule {}
