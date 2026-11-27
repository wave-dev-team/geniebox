import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class FactDto {
  @ApiProperty({ example: 'Кому' })
  label: string;

  @ApiProperty({ example: '200 ушедших за месяц' })
  value: string;
}

export class CardDto {
  @ApiProperty({ enum: ['task', 'decision', 'chart'] })
  type: 'task' | 'decision' | 'chart';

  @ApiProperty({ format: 'uuid', description: 'Task, decision or metric (chart)' })
  id: string;

  @ApiPropertyOptional({ description: 'Chart period, days' })
  days?: number;
}
