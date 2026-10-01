use crate::foo::Item;
use super::foo;

pub mod sub;

pub fn from_bar() -> Item {
    foo::make()
}
