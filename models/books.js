const mongoose = require('mongoose');
let bookSchema = mongoose.Schema({
    _id: mongoose.Schema.Types.ObjectId,
    title: {
        type: String,
        required: true
    },
    author: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Author'
    },
    isbn: {
      type:String,
      minlength:13,
      maxlength:13
    },
    date_of_publication: {
        type: Date,
        default: Date.now
    },
    summary: String
});
module.exports = mongoose.model('Books', bookSchema);
