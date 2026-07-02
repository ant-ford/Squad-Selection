import base from "../services/airtable";

export interface FindAllOptions {
  filterByFormula?: string;
  sort?: {
    field: string;
    direction?: "asc" | "desc";
  }[];
  maxRecords?: number;
}

export class AirtableRepository<T> {
  constructor(
    private tableName: string,
    private mapper: (record: any) => T
  ) {}

  async findAll(
    options?: FindAllOptions
  ): Promise<T[]> {
    const records = await base(this.tableName)
      .select(options)
      .all();

    return records.map(this.mapper);
  }

  async findOne(
    id: string
  ): Promise<T | null> {
    try {
      const record =
        await base(this.tableName).find(id);

      return this.mapper(record);
    } catch {
      return null;
    }
  }

  async create(
    fields: Record<string, any>
  ) {
    return base(this.tableName).create(fields);
  }

  async update(
    id: string,
    fields: Record<string, any>
  ) {
    return base(this.tableName).update(
      id,
      fields
    );
  }

  async delete(id: string) {
    return base(this.tableName).destroy(id);
  }
}