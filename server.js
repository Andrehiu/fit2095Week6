// optionally can customize working path other than current path
// using Windows Control Panel -> System
// or using command line: setx WORKING_PATH "c:/Atom Projects/Week N"
working_path = process.env.WORKING_PATH
if (working_path) {
  console.log('Using working path "' + working_path + '"');
  process.chdir(working_path);  // change directory to path specified by environment variable WORKING_PATH
} else {
  console.log('Using default working path');
}

const mongoose = require('mongoose');

const Author = require('./models/author');
const Book = require('./models/books');

let express = require("express");
let app = express();
let viewsPath = __dirname + "/views/";
let bodyParser = require("body-parser");
let ejs = require("ejs");
const randomnumber = require("randomstring");
const mongodb = require("mongodb");
const MongoClient = mongodb.MongoClient;
const url = "mongodb://localhost:27017/";
let db;

app.engine("html", require("ejs").renderFile);
app.set("view engine", "html");

app.use(express.static("public/img"));
app.use(express.static("css"));

app.use(
  bodyParser.urlencoded({
    extended: false,
  })
);
mongoose.connect('mongodb://localhost:27017/FIT2095', function (err) {
    if (err) {
        console.log('Error in Mongoose connection');
        throw err;
    }
console.log('Connected to Mongoose DB');
//Test new addition
// let author1 = new Author({
//         _id: new mongoose.Types.ObjectId(),
//         name: {
//             firstName: 'Tim',
//             lastName: 'John'
//         },
//         date_of_birth: '1997-06-23',
//         address: {
//           State: 'ABC',
//           Suburb: 'TestSuburb',
//           Street: 'TestStreet',
//           Unit: 'TestUnit'
//         },
//         numBooks: 2
//     });
//     author1.save(function (err) {
//         if (err) throw err;
//         console.log('Author successfully Added to DB');
//         var book1 = new Book({
//             _id: new mongoose.Types.ObjectId(),
//             title: 'FIT2095 Book ',
//             author: author1._id,
//             isbn: '1234567891234',
//             date_of_publication: '1998-07-24',
//             summary: 'This is the test summary for book1'
//         });
//         book1.save(function (err) {
//             if (err) throw err;
//             console.log('Book1 successfully Added to DB');
//         });
//         var book2 = new Book({
//           _id: new mongoose.Types.ObjectId(),
//           title: 'FIT2095 Book ',
//           author: author1._id,
//           isbn: '1234567891233',
//           date_of_publication: '1999-09-25',
//           summary: 'This is the test summary for book2'
//         });
//         book2.save(function (err) {
//             if (err) throw err;
//             console.log('Book2 successfully add to DB');
//         });
//     });
  });
app.get("/", function(req, res) {
  console.log("Homepage request");
  let fileName = viewsPath + "index.html";
  res.sendFile(fileName);
});
// GET Requests

app.get("/addbook", function(req, res) {
  console.log("Add New book request" + generateISBN());
  let fileName = viewsPath + "addbook.html";
  Author.find({}, function (err, data) {
      res.render(fileName, {generatedisbn: generateISBN(),authors: data});
  });

});

app.get('/addauthor', function (req,res) {
  res.sendFile(__dirname + '/views/addauthor.html');
});

app.get("/getbooks", function(req, res) {
  console.log("Get All Books request");
  let fileName = viewsPath + "getbooks.html"
  const authorNameList = [];
  const authorIdList = [];
  Book.find({}, function (err, data) {
        let authorName;
        for(let i = 0; i < data.length; i++) {
          let id = data[i].author;
          authorIdList.push(id);
        }
        for(let i = 0; i < authorIdList.length; i++) {
          let id = authorIdList[i];
          // Author.findById(id,function (err, author) {
          //   authorName = {
          //     fName: author.name.firstName,
          //     lName: author.name.lastName
          //   };
          //   console.log(authorName);
          //   authorNameList.push(authorName);
          // });
          // authorNameList.push(findUser(id));
        }
        res.render(fileName, {books: data});
  });


});

app.get("/getauthors", function(req, res) {
  console.log("Get All Authors request");
  Author.find({}, function (err, data) {
        res.render('getauthors', { authors: data });
  });
});

app.get('/deletebook', function (req, res) {
    res.sendFile(__dirname + '/views/deletebook.html');
});

app.get('/updateauthor', function (req, res) {
  Author.find({}, function (err, data) {
        res.render('updateauthor', { authors: data });
  });
});

app.get('/updatebookwithtitle', function (req, res) {
    res.sendFile(__dirname + '/views/updatebookwithtitle.html');
});

app.get("/invalidData", function(req,res) {
  console.log("Invalid Data");
  let fileName = viewsPath + "error.html";
  res.sendFile(fileName);
});

// POST Requests

app.post("/newBook", function(req, res) {
  let bookDetails = req.body;
  var newBook = new Book({
           _id: new mongoose.Types.ObjectId(),
           title: bookDetails.title,
           author: bookDetails.authorid,
           isbn: bookDetails.isbn,
           date_of_publication: bookDetails.dop,
           summary: bookDetails.summary
  });
      newBook.save(function (err) {
          if (err) {
            let fileName = viewsPath + "error.html";
            res.render(fileName, {error: err});
          }
          else console.log('Book successfully Added to DB');
      });
  Author.updateOne({ _id: bookDetails.authorid  }, { $inc: { numBooks: 1 } }, function (err, doc) {//Increments books for author id
    console.log('Number of books incremented');
  });
  res.redirect('/getbooks');
});

app.post("/newAuthor", function(req, res) {
  let authorDetails = req.body;
  let newAuthor = new Author({
          _id: new mongoose.Types.ObjectId(),
          name: {
              firstName: authorDetails.fname,
              lastName: authorDetails.lname
          },
          date_of_birth: authorDetails.dob,
          address: {
            State: authorDetails.state,
            Suburb: authorDetails.suburb,
            Street: authorDetails.street,
            Unit: authorDetails.Unit
          },
          numBooks: authorDetails.numbooks
      });
      newAuthor.save(function (err) {
          if (err) {
            let fileName = viewsPath + "error.html";
            res.render(fileName, {error: err});
          }
          else console.log('Author successfully Added to DB');
      });
});

app.post("/deletebook", function (req, res) {
  console.log("Delete book request");
  let bookDetails = req.body;
  Book.deleteMany({ isbn: bookDetails.isbn }, function (err, doc) {
    console.log('Deleted Books');
  });
  res.redirect('/getbooks');
});

app.post("/updateauthor", function (req, res) {
  console.log("Update Author Post Request");
  let authorDetails = req.body;
  Author.updateOne({ _id: authorDetails.authorid  }, { $set: { numBooks: authorDetails.numbooks } }, function (err, doc) {//Increments books for author id
    console.log('Number of books incremented');
  });
  res.redirect('/getauthors');
});

// app.post("/updateBookTitle", function (req, res) {
//   console.log("Update Book Post Request");
//   let bookDetails = req.body;
//   let filter = { Title: bookDetails.title};
//   let updateddetails = { $set: {Author: bookDetails.author } };
//   db.collection('Week5BookTable').updateMany(filter, updateddetails);
//   res.redirect('/getbooks');
// });

app.get('/*', function(req, res) {
    let fileName = viewsPath + "404.html";
    res.sendFile(fileName);
});

app.listen(8080);

function generateISBN() {
  try{
    return randomnumber.generate({
      length: 13,
      charset: "numeric"
    });
  }
  catch(e) {
    console.log(e);
  }
}
