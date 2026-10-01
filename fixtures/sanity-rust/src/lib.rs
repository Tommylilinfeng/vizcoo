pub mod foo;
pub mod bar;

pub use crate::foo::Item;

pub fn main_thing() -> Item {
    foo::make()
}
