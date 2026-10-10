import type {Metadata} from "next";
import PaperChallengeRecovery from "@/components/PaperChallengeRecovery";
export const dynamic="force-dynamic";
export const metadata:Metadata={
 title:"Reset CreatorHub password | BigOrders",
 description:"Secure email-verified CreatorHub account recovery.",
};
export default function RecoveryPage(){return <PaperChallengeRecovery/>;}
