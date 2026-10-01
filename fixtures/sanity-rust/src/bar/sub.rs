use crate::foo::Item;
use crate::bar::from_bar;

pub fn use_both() -> Item {
    let _ = from_bar();
    Item { value: 0 }
}
