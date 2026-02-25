export default function KeywordBlocks() {
  const sections = [
    {
      title: "급상승",
      icon: "🔥",
      items: [
        { name: "SOL", price: "$98.45", change: "+5.67%" },
        { name: "AVAX", price: "$35.60", change: "+4.28%" },
        { name: "BNB", price: "$315.20", change: "+3.45%" },
        { name: "MATIC", price: "$0.82", change: "+2.76%" },
        { name: "BTC", price: "$43,250", change: "+2.34%" },
      ],
    },
    {
      title: "거래량",
      icon: "📊",
      items: [
        { name: "BTC", price: "$43,250", change: "+2.34%" },
        { name: "ETH", price: "$2,280", change: "-1.22%" },
        { name: "SOL", price: "$98.45", change: "+5.67%" },
        { name: "XRP", price: "$0.58", change: "-0.85%" },
        { name: "BNB", price: "$315.20", change: "+3.45%" },
      ],
    },
    {
      title: "인기",
      icon: "⭐",
      items: [
        { name: "BTC", price: "$43,250", change: "+2.34%" },
        { name: "ETH", price: "$2,280", change: "-1.22%" },
        { name: "DOGE", price: "$0.085", change: "-2.15%" },
      ],
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      {sections.map((section) => (
        <div key={section.title} className="rounded-2xl bg-white p-6 shadow-sm dark:bg-zinc-900">
          <div className="mb-4 flex items-center gap-2">
            <span className="text-xl">{section.icon}</span>
            <h3 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
              {section.title}
            </h3>
          </div>
          <div className="flex flex-col gap-4">
            {section.items.map((item) => (
              <div key={item.name} className="flex items-center justify-between text-sm">
                <span className="font-medium text-zinc-700 dark:text-zinc-300">
                  {item.name}
                </span>
                <div className="flex gap-4">
                <span className="text-zinc-500">{item.price}</span>
                  <span className={item.change.startsWith("+") ? "text-profit" : "text-loss"}>
                    {item.change}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
