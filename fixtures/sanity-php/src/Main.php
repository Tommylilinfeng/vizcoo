<?php
namespace App;

use App\Util\Helper;
use App\Lib\Logger;

class Main {
    public function run(): void {
        $h = new Helper("hi");
        Logger::log($h->shout());
    }
}
