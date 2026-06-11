import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ScheduledJob } from './schemas/scheduled-job.schema';
import { Persona } from '../telegram-accounts/schemas/persona.schema';

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    @InjectModel(ScheduledJob.name) private readonly jobModel: Model<ScheduledJob>,
    @InjectModel(Persona.name) private readonly personaModel: Model<Persona>,
  ) {}

  async scheduleJob(
    personaId: string | Types.ObjectId,
    candidateId: string | Types.ObjectId | null,
    type: 'followup' | 'reminder' | 'nudge' | 'greeting',
    scheduledAt: Date,
    payload: Record<string, unknown> = {},
  ): Promise<ScheduledJob> {
    const finalScheduledAt = await this.adjustForQuietHours(
      new Types.ObjectId(personaId),
      scheduledAt,
    );

    // Cancel existing pending jobs of the same type for this candidate to avoid spam
    if (candidateId) {
      await this.jobModel
        .updateMany(
          {
            candidateId: new Types.ObjectId(candidateId),
            type,
            status: 'pending',
          },
          { status: 'cancelled' },
        )
        .exec();
    }

    return this.jobModel.create({
      personaId: new Types.ObjectId(personaId),
      candidateId: candidateId ? new Types.ObjectId(candidateId) : null,
      type,
      scheduledAt: finalScheduledAt,
      payload,
      status: 'pending',
    });
  }

  async adjustForQuietHours(personaId: Types.ObjectId, date: Date): Promise<Date> {
    const persona = await this.personaModel.findById(personaId).exec();
    if (!persona || !persona.quietHours) return date;

    const { start, end, timezone } = persona.quietHours;
    // Basic parser for 'HH:MM' quiet hours format in local/UTC time.
    // Convert date to the specified timezone or local time.
    const hour = date.getUTCHours() + 3; // Ukraine time is roughly UTC+2/+3, let's assume Kiev timezone or timezone offset

    const [startHourStr] = (start || '23:00').split(':');
    const [endHourStr] = (end || '08:00').split(':');
    const startHour = parseInt(startHourStr, 10);
    const endHour = parseInt(endHourStr, 10);

    const checkHour = (hour + 24) % 24;

    let isQuiet = false;
    if (startHour > endHour) {
      // Overnight range, e.g. 23:00 to 08:00
      isQuiet = checkHour >= startHour || checkHour < endHour;
    } else {
      // Day range, e.g. 09:00 to 18:00
      isQuiet = checkHour >= startHour && checkHour < endHour;
    }

    if (isQuiet) {
      // Shift to end of quiet hours (i.e. next morning at endHour)
      const adjusted = new Date(date);
      adjusted.setUTCHours((endHour - 3 + 24) % 24, 0, 0, 0);
      if (adjusted.getTime() <= date.getTime()) {
        adjusted.setDate(adjusted.getDate() + 1);
      }
      this.logger.log(
        `Scheduled date ${date.toISOString()} was in quiet hours for persona ${personaId}, adjusted to ${adjusted.toISOString()}`,
      );
      return adjusted;
    }

    return date;
  }

  async getPendingJobs(): Promise<ScheduledJob[]> {
    return this.jobModel
      .find({
        status: 'pending',
        scheduledAt: { $lte: new Date() },
      })
      .exec();
  }

  async executeJob(id: string | Types.ObjectId): Promise<ScheduledJob | null> {
    return this.jobModel
      .findByIdAndUpdate(id, { status: 'executed', executedAt: new Date() }, { new: true })
      .exec();
  }

  async failJob(id: string | Types.ObjectId): Promise<ScheduledJob | null> {
    return this.jobModel
      .findByIdAndUpdate(id, { status: 'failed', executedAt: new Date() }, { new: true })
      .exec();
  }

  async cancelJobsForCandidate(candidateId: string | Types.ObjectId): Promise<void> {
    await this.jobModel
      .updateMany(
        { candidateId: new Types.ObjectId(candidateId), status: 'pending' },
        { status: 'cancelled' },
      )
      .exec();
  }
}
