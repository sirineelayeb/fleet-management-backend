// backend/src/utils/pagination.js
class PaginatedResponse {
  constructor(data, total, page, limit) {
    this.data = data;
    this.pagination = {
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages: Math.ceil(total / limit),
      hasNextPage: page * limit < total,
      hasPrevPage: page > 1
    };
  }

  static async fromQuery(model, query = {}, page = 1, limit = 10, populate = []) {
    const skip = (page - 1) * limit;
    const total = await model.countDocuments(query);
    
    let dataQuery = model.find(query).skip(skip).limit(parseInt(limit));
    
    // Apply populations
    if (populate.length > 0) {
      populate.forEach(pop => {
        dataQuery = dataQuery.populate(pop);
      });
    }
    
    const data = await dataQuery;
    
    return new PaginatedResponse(data, total, page, limit);
  }
}

module.exports = PaginatedResponse;