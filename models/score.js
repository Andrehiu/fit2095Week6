const mongoose = require('mongoose');

const isInt = {
  validator: Number.isInteger,
  message: '{PATH} must be an integer'
};

let scoreSchema = mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    minlength: 1,
    maxlength: 12
  },
  score: {
    type: Number,
    required: true,
    min: 0,
    max: 10000000,
    validate: isInt
  },
  wave: {
    type: Number,
    required: true,
    min: 1,
    max: 999,
    validate: isInt
  },
  kills: {
    type: Number,
    min: 0,
    default: 0,
    validate: isInt
  },
  durationMs: {
    type: Number,
    min: 0
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

scoreSchema.index({ score: -1 });

module.exports = mongoose.model('Score', scoreSchema);
