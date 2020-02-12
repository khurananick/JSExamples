// To run the script as is:
// > node hoover.js
// To run a test:
// > node hoover.js test

let test;
for(var index in process.argv) {
  if(process.argv[index] == "test") test = true;
}

let Grid = function(max_x, max_y, min_x=0, min_y=0) {
  let Self = {
    grid: [],
    cursor_position: [0,0],
    create: function() {
    },
    make: function(x, y, do_print=true) {
      let arr1 = [];
      let arr2 = [];
      for(var x=0; x<max_x; x++) arr1[x] = x;
      for(var y=0; y<max_y; y++) arr2[y] = y;
      for(var index in arr1) {
        arr1[index] = [];
        for(var index2 in arr2) {
          arr1[index].push(index + " " +index2);
        }
      }
      Self.grid = arr1;
      if(do_print) Self.print();
    },
    set_cursor_position: function(x, y, do_print=true) {
      if(x > (max_x-1)) x = (max_x-1);
      if(y > (max_y-1)) y = (max_y-1);
      if(x < min_x) x = min_x;
      if(y < min_y) y = min_y;
      Self.cursor_position = [x, y];
      if(do_print) Self.print();
      return Self.cursor_position
    },
    print: function() {
      console.log("=====================================");
      Self.grid[Self.cursor_position[0]][Self.cursor_position[1]] = Self.grid[Self.cursor_position[0]][Self.cursor_position[1]].replace(" ", "*")
      console.log(Self.grid.reverse());
      Self.grid.reverse();
      Self.grid[Self.cursor_position[0]][Self.cursor_position[1]] = Self.grid[Self.cursor_position[0]][Self.cursor_position[1]].replace("*", " ")
      console.log("=====================================");
    }
  };
  (function initialize() {
    Self.make(max_x, max_y, false);
  })();
  return Self;
};

let Hoover = function(grid) {
  let Self = {
    grid: grid,
    move: function(direction, steps, do_print=true) {
      if(do_print) console.log("Moving", direction, steps);
      x = Self.grid.cursor_position[0];
      y = Self.grid.cursor_position[1];
      if(direction == "S")
        x = x + steps;
      else if(direction == "W")
        y = y + steps;
      else if(direction == "N")
        x = x - steps;
      else if(direction == "E")
        y = y - steps;
      Self.grid.set_cursor_position(x, y, do_print);
      return x + ' ' + y;
    }
  };
  return Self;
};

function run(data, do_print, callback) {
  // create grid based on first line.
  let grid_size = data.shift().split(' ');
  let grid = Grid(Number(grid_size[0]),Number(grid_size[1]));

  // set starting position based on second line
  let start_pos = data.shift().split(' ');
  if(do_print) console.log('Start Position', start_pos);
  grid.set_cursor_position(Number(start_pos[0]),Number(start_pos[1]),do_print);

  // create hoover.
  let hoover = Hoover(grid);

  // get instructions from last line
  let instructions = data.pop().split('');
  let current_position;
  let patches_count = 0;
  for(var direction of instructions) {
    current_position = hoover.move(direction, 1, do_print);
    if(data.indexOf(current_position) > -1)
      patches_count += 1;
  }
  if(callback) callback(current_position, patches_count);
}

function runProd() {
  const fs = require('fs');
  fs.readFile('input.txt', 'utf8', function(err, data) {
    // lines in file into array
    data = data.split("\n");
    data.pop(); // popping last item in array because it's empty.

    run(data, true, function(current_position, patches_count) {
      console.log("Final position:", current_position);
      console.log("Patches cleaned:", patches_count);
    });
  });
}

function runTest() {
  let data = ['5 5', '1 2', '1 0', '2 2', '2 3', 'NNESEESWNWW'];
  run(data, false, function(current_position, patches_count) {
    if(current_position == '1 3' && patches_count == 1)
      console.log('Passed.');
    else
      console.log("\x1b[41m%s\x1b[0m", "Failed.");
  });
}

if(test) runTest();
else runProd();
