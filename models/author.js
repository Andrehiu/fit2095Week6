const mongoose = require('mongoose');
let authorSchema = mongoose.Schema({
    _id: mongoose.Schema.Types.ObjectId,
    name: {
        firstName: {
            type: String,
            required: true
        },
        lastName: String
    },
    date_of_birth: {
        type: Date,
    },
    address: {
      State: {
        type:String,
        validate: {
          validator: function (state) {
            return state.length >= 2 && state.length <= 3;
          },
          message: 'State min 2, max 3 characters'
        }
      },
      Suburb:String,
      Street:String,
      Unit:String,
    },//End of address object
    numBooks: {
      type:Number,
      validate:
        {validator:function(numBooks) {
          return numBooks >= 1 && numBooks <= 150;
        },
        message: 'Author must have at least 1 book with a max of 150'
      }
    }
});
// var numBooksValidators = [
//   // {validator: Number.isInteger,
//   //   message: 'Number must be an integer'},
//   {validator: function(numBooks) {return numBooks >= 1 && numBooks <= 150},
//     message: 'Author must have at least 1 book with a max of 150'
//   }
// ];
module.exports = mongoose.model('Author', authorSchema);
