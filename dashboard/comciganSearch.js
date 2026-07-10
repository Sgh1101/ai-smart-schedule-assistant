const { searchSchools } = require('./comciganClient');

async function searchSchoolWithRegion(keyword) {
  return searchSchools(keyword);
}

module.exports = { searchSchoolWithRegion };
