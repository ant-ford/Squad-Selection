import base from '@/services/airtable';

export interface FindAllOptions {
  filterByFormula?: string;
  sort?: Array<{ field: string; direction?: 'asc' | 'desc' }>;
  maxRecords?: number;
  offset?: string;
}

export class AirtableRepository<T> {
  protected table: any;

  constructor(
    private tableName: string,
    private mapper: (record: any) => T
  ) {
    this.table = base(this.tableName);
  }

  async findAll(options?: FindAllOptions): Promise<T[]> {
    const records = await this.table.select(options).all();
    return records.map(this.mapper);
  }

  async findById(id: string): Promise<T | null> {
    try {
      const record = await this.table.find(id);
      return this.mapper(record);
    } catch {
      return null;
    }
  }

  async create(fields: Record<string, any>): Promise<any> {
    const record = await this.table.create(fields);
    return record;
  }

  async update(id: string, fields: Record<string, any>): Promise<any> {
    const record = await this.table.update(id, fields);
    return record;
  }

  async delete(id: string): Promise<void> {
    await this.table.destroy(id);
  }
}