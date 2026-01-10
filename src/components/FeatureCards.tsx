import { motion } from "framer-motion";
import { Wallet, Sparkles, Gift, Users } from "lucide-react";

const features = [
  {
    icon: Wallet,
    title: "Instant Wallet",
    description: "Fund your wallet via bank or card in seconds",
    color: "text-primary",
    bgColor: "bg-primary/10",
  },
  {
    icon: Sparkles,
    title: "AI Avatars",
    description: "Create your unique digital persona",
    color: "text-secondary",
    bgColor: "bg-secondary/10",
  },
  {
    icon: Gift,
    title: "Giveaways",
    description: "Host or join exciting money drops",
    color: "text-accent",
    bgColor: "bg-accent/10",
  },
  {
    icon: Users,
    title: "Live Events",
    description: "Spray at weddings, parties & more",
    color: "text-success",
    bgColor: "bg-success/10",
  },
];

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20, scale: 0.9 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      type: "spring" as const,
      stiffness: 100,
      damping: 15,
    },
  },
};

export const FeatureCards = () => {
  return (
    <section className="px-6 py-8">
      <motion.div
        className="grid grid-cols-2 gap-4"
        variants={containerVariants}
        initial="hidden"
        animate="visible"
      >
        {features.map((feature, index) => (
          <motion.div
            key={feature.title}
            variants={itemVariants}
            whileHover={{ scale: 1.03, y: -4 }}
            whileTap={{ scale: 0.98 }}
            className="glass rounded-3xl p-5 card-interactive cursor-pointer"
          >
            <div className={`${feature.bgColor} w-12 h-12 rounded-2xl flex items-center justify-center mb-3`}>
              <feature.icon className={`w-6 h-6 ${feature.color}`} />
            </div>
            <h3 className="font-bold text-foreground mb-1">{feature.title}</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {feature.description}
            </p>
          </motion.div>
        ))}
      </motion.div>
    </section>
  );
};
