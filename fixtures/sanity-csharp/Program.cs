using System;
using MyApp.Util;
using MyApp.Lib;
using LoggerAlias = MyApp.Lib.Logger;

namespace MyApp;

class Program
{
    static void Main()
    {
        var h = new Helper("hi");
        LoggerAlias.Log(h.Shout());
        Other.Greet();
    }
}
